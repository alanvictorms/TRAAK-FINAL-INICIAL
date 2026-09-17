"""Envio de disparos: monta a lista a partir do segmento e envia em lotes.

Antes deste módulo um disparo era só um documento 'draft': nada saía.
"""
import asyncio
import logging
import random
from datetime import datetime, timedelta, timezone

from bson import ObjectId

from analytics import workspace_tz
from database import active_policy, db, is_killed
from prove_logic import in_send_window
from messaging import send_channel_message
from segments import segment_query

logger = logging.getLogger(__name__)

POLL_SECONDS = 5
BATCH = 25                # o Telegram aceita ~30 msg/s por bot
PAUSE_BETWEEN = 0.05


def contact_for(player, provider):
    if provider == "whatsapp":
        return (player.get("contact") or {}).get("phone") or (player.get("external_ids") or {}).get("whatsapp_user_id")
    return (player.get("external_ids") or {}).get(f"{provider}_user_id")


def pick(variants, rnd=random):
    pool = [v for v in variants if str(v.get("text") or "").strip() and float(v.get("weight") or 0) > 0]
    if not pool:
        return None
    point = rnd.uniform(0, sum(float(v["weight"]) for v in pool))
    for v in pool:
        point -= float(v["weight"])
        if point <= 0:
            return v
    return pool[-1]


def variants_of(dispatch):
    content = dispatch.get("content") or {}
    variants = content.get("variants") or []
    if not variants and str(content.get("text") or "").strip():
        variants = [{"name": "A", "text": content["text"], "weight": 1}]
    return variants


async def eligible_recipients(dispatch, integration):
    """(elegíveis, pulados por motivo) — é também o pré-voo."""
    ws_id = dispatch["workspace_id"]
    provider = integration.get("provider")
    segment = None
    if dispatch.get("segment_id") and ObjectId.is_valid(dispatch["segment_id"]):
        segment = await db.segments.find_one({"_id": ObjectId(dispatch["segment_id"]), "workspace_id": ws_id})
    query = segment_query(ws_id, (segment or {}).get("conditions"), (segment or {}).get("logic", "and"))
    suppressed = {s["contact"] async for s in db.suppressions.find({"workspace_id": ws_id, "provider": provider}, {"contact": 1})}
    eligible, skipped, total = [], {"sem_contato": 0, "suprimido": 0}, 0
    async for player in db.players.find(query, {"name": 1, "external_ids": 1, "contact": 1}):
        total += 1
        contact = contact_for(player, provider)
        if not contact:
            skipped["sem_contato"] += 1
        elif str(contact) in suppressed:
            skipped["suprimido"] += 1
        else:
            eligible.append((player, str(contact)))
    return total, eligible, skipped


async def _build(dispatch, integration):
    total, eligible, skipped = await eligible_recipients(dispatch, integration)
    variants = variants_of(dispatch)
    now = datetime.now(timezone.utc)
    docs = []
    for player, contact in eligible:
        variant = pick(variants)
        docs.append({
            "dispatch_id": str(dispatch["_id"]), "workspace_id": dispatch["workspace_id"],
            "player_id": str(player["_id"]), "player_name": player.get("name"), "contact": contact,
            "variant": variant.get("name") if variant else None, "text": (variant or {}).get("text"),
            "status": "queued", "created_at": now,
        })
    if docs:
        await db.dispatch_recipients.insert_many(docs)
    await db.dispatches.update_one({"_id": dispatch["_id"]}, {"$set": {
        "stats.target": total, "stats.eligible": len(docs), "stats.skipped": skipped,
        "recipients_built": True, "started_at": now,
    }})


def _render(text, name):
    name = (name or "").strip()
    return (text or "").replace("{nome}", name).replace("{primeiro_nome}", name.split(" ")[0] if name else "")


async def _hold(dispatch, reason, seconds):
    await db.dispatches.update_one({"_id": dispatch["_id"]}, {"$set": {
        "locked_until": datetime.now(timezone.utc) + timedelta(seconds=seconds), "paused_reason": reason}})


async def process_dispatch(dispatch):
    ws_id = dispatch["workspace_id"]
    if await is_killed(ws_id, "dispatches"):
        return await _hold(dispatch, "Disparos bloqueados em Governança", 60)
    window = await active_policy(ws_id, "send_window")
    if window:
        ws = await db.workspaces.find_one({"_id": ObjectId(ws_id)}) if ObjectId.is_valid(str(ws_id)) else None
        hour = datetime.now(timezone.utc).astimezone(workspace_tz((ws or {}).get("timezone"))).hour
        start, end = int(window["config"]["start_hour"]), int(window["config"]["end_hour"])
        if not in_send_window(hour, start, end):
            return await _hold(dispatch, f"Fora da janela de envio ({start}h–{end}h)", 300)
    integration = await db.integrations.find_one({"_id": ObjectId(dispatch["channel"]), "workspace_id": dispatch["workspace_id"]}) \
        if ObjectId.is_valid(str(dispatch.get("channel"))) else None
    if not integration:
        await db.dispatches.update_one({"_id": dispatch["_id"]}, {"$set": {"status": "failed", "error": "canal não encontrado"}})
        return
    if not dispatch.get("recipients_built"):
        await _build(dispatch, integration)

    batch = await db.dispatch_recipients.find({"dispatch_id": str(dispatch["_id"]), "status": "queued"}).limit(BATCH).to_list(BATCH)
    for r in batch:
        fake_conversation = {"integration_id": str(integration["_id"]), "workspace_id": dispatch["workspace_id"],
                             "external_chat_id": r["contact"]}
        update = {"sent_at": datetime.now(timezone.utc)}
        try:
            result = await send_channel_message(fake_conversation, _render(r["text"], r.get("player_name")))
            update.update({"status": "sent", "external_id": result.get("external_id")})
        except Exception as exc:  # noqa: BLE001 — falha de um destinatário não para o disparo
            update.update({"status": "failed", "error": str(exc)[:200]})
        await db.dispatch_recipients.update_one({"_id": r["_id"]}, {"$set": update})
        await asyncio.sleep(PAUSE_BETWEEN)

    counts = {c["_id"]: c["n"] async for c in db.dispatch_recipients.aggregate([
        {"$match": {"dispatch_id": str(dispatch["_id"])}}, {"$group": {"_id": "$status", "n": {"$sum": 1}}}])}
    done = not counts.get("queued")
    current = await db.dispatches.find_one({"_id": dispatch["_id"]}, {"status": 1})
    status = (current or {}).get("status")
    if status == "cancelled":
        return
    await db.dispatches.update_one({"_id": dispatch["_id"]}, {"$set": {
        "stats.sent": counts.get("sent", 0), "stats.failed": counts.get("failed", 0),
        "status": "sent" if done else "sending", "locked_until": None, "paused_reason": None,
        **({"finished_at": datetime.now(timezone.utc)} if done else {}),
    }})


async def worker_loop():
    while True:
        try:
            now = datetime.now(timezone.utc)
            while True:
                dispatch = await db.dispatches.find_one_and_update(
                    {"$or": [
                        {"status": "queued"},
                        {"status": "scheduled", "scheduled_at": {"$lte": now}},
                        {"status": "sending", "$or": [{"locked_until": None}, {"locked_until": {"$lte": now}}]},
                    ]},
                    {"$set": {"status": "sending", "locked_until": now + timedelta(seconds=120)}},
                    sort=[("created_at", 1)], return_document=True,
                )
                if not dispatch:
                    break
                await process_dispatch(dispatch)
        except Exception as exc:  # noqa: BLE001
            logger.error("worker de disparos: %s", exc)
        await asyncio.sleep(POLL_SECONDS)
