"""Executor das automações: pega execuções prontas, anda o grafo e aplica efeitos.

Antes deste módulo as execuções nasciam 'queued' e ninguém as processava:
nenhum fluxo publicado enviava mensagem.
"""
import asyncio
import ipaddress
import logging
import socket
from datetime import datetime, timedelta, timezone
from urllib.parse import urlsplit

import httpx
from bson import ObjectId

from automation_engine import advance, trigger_id
from database import db, is_killed
from messaging import send_channel_message
from realtime import inbox_events

logger = logging.getLogger(__name__)

POLL_SECONDS = 5
LOCK_SECONDS = 120
BATCH = 20


async def _safe_webhook_url(url: str) -> bool:
    """Só http(s) para IP público: o servidor não pode ser usado para sondar a rede interna."""
    parts = urlsplit(url or "")
    if parts.scheme not in ("http", "https") or not parts.hostname:
        return False
    try:
        infos = await asyncio.get_running_loop().getaddrinfo(parts.hostname, parts.port or 443)
    except socket.gaierror:
        return False
    for info in infos:
        ip = ipaddress.ip_address(info[4][0])
        if ip.is_private or ip.is_loopback or ip.is_link_local or ip.is_reserved or ip.is_multicast or ip.is_unspecified:
            return False
    return True


async def _ai_reply(workspace_id, prompt, message):
    from routes.copilot_routes import get_ai_config
    from emergentintegrations.llm.chat import LlmChat, UserMessage
    if await is_killed(workspace_id, "ai"):
        raise RuntimeError("IA bloqueada em Governança")
    config = await get_ai_config()
    if not config:
        raise RuntimeError("nenhum provedor de IA configurado")
    chat = LlmChat(api_key=config["api_key"], session_id=f"automation_{workspace_id}_{ObjectId()}",
                   system_message=prompt).with_model(config["provider"], config["model"])
    return (await chat.send_message(UserMessage(text=message or "(sem texto)"))).strip()


async def _record(conv, text, kind="automation"):
    now = datetime.now(timezone.utc)
    msg = {
        "conversation_id": str(conv["_id"]), "workspace_id": conv["workspace_id"],
        "sender_id": "system:automation", "sender_name": "Automação",
        "content": text, "type": kind, "direction": "outbound", "created_at": now,
    }
    await db.messages.insert_one(msg)
    await db.conversations.update_one({"_id": conv["_id"]}, {"$set": {"updated_at": now, "last_message": text[:100]}})
    await inbox_events.publish(conv["workspace_id"], {"type": "message.sent", "conversation_id": str(conv["_id"])})


async def apply_effects(run, conv, player, effects, ctx):
    """Aplica em ordem. Falha de um efeito vira log e interrompe a execução."""
    log = []
    for effect in effects:
        kind = effect["type"]
        entry = {"at": datetime.now(timezone.utc), "node": effect.get("node"), "type": kind}
        try:
            if kind == "send":
                delivery = await send_channel_message(conv, effect["text"])
                await _record(conv, effect["text"])
                entry["detail"] = delivery.get("status")
            elif kind == "ai_reply":
                text = await _ai_reply(run["workspace_id"], effect["prompt"], ctx.get("message"))
                await send_channel_message(conv, text)
                await _record(conv, text)
                entry["detail"] = text[:120]
            elif kind == "tags" and player:
                tags = [t for t in player.get("tags") or [] if t not in effect["remove"]]
                tags += [t for t in effect["add"] if t not in tags]
                await db.players.update_one({"_id": player["_id"]}, {"$set": {"tags": tags}})
                player["tags"] = tags
            elif kind == "stage" and player:
                await db.players.update_one({"_id": player["_id"]}, {"$set": {"pipeline_stage": effect["stage"]}})
            elif kind == "close_conversation":
                await db.conversations.update_one({"_id": conv["_id"]}, {"$set": {
                    "status": "resolved", "closed_at": datetime.now(timezone.utc), "closed_by": "system:automation"}})
            elif kind == "reopen_conversation":
                await db.conversations.update_one({"_id": conv["_id"]}, {"$set": {"status": "queue"}})
            elif kind == "handoff":
                update = {"status": "queue", "assigned_to": None, "assigned_name": None}
                if effect.get("agent_id") and ObjectId.is_valid(effect["agent_id"]):
                    agent = await db.users.find_one({"_id": ObjectId(effect["agent_id"]), "workspace_id": run["workspace_id"]})
                    if agent:
                        update = {"status": "active", "assigned_to": str(agent["_id"]), "assigned_name": agent.get("name", "")}
                await db.conversations.update_one({"_id": conv["_id"]}, {"$set": update})
                await inbox_events.publish(run["workspace_id"], {"type": "conversation.assigned", "conversation_id": str(conv["_id"])})
            elif kind == "webhook":
                if not await _safe_webhook_url(effect["url"]):
                    raise RuntimeError("URL bloqueada: só endereços públicos http(s)")
                async with httpx.AsyncClient(timeout=10, follow_redirects=False) as client:
                    response = await client.post(effect["url"], json={
                        "automation_id": run["automation_id"], "run_id": str(run["_id"]),
                        "conversation_id": str(conv["_id"]), "player_id": run.get("player_id"),
                        "player_name": (player or {}).get("name"), "message": ctx.get("message"),
                    })
                entry["detail"] = f"HTTP {response.status_code}"
            elif kind == "log":
                entry["detail"] = effect.get("text")
        except Exception as exc:  # noqa: BLE001 — erro de efeito vira falha registrada da execução
            entry["error"] = str(exc)[:300]
            log.append(entry)
            return log, str(exc)
        log.append(entry)
    return log, None


async def _context(run, conv, player):
    last = await db.messages.find_one({"conversation_id": str(conv["_id"]), "direction": "inbound"}, sort=[("created_at", -1)])
    return {
        "message": run.get("resume_reply") or (last or {}).get("content") or "",
        "player_name": (player or {}).get("name"),
        "tags": (player or {}).get("tags") or [],
        "has_ftd": (player or {}).get("has_ftd"),
        "source": (player or {}).get("source"),
        "stage": (player or {}).get("pipeline_stage"),
    }


async def process_run(run):
    now = datetime.now(timezone.utc)
    graph = {"nodes": run.get("nodes") or [], "edges": run.get("edges") or []}
    conv = await db.conversations.find_one({"_id": ObjectId(run["conversation_id"])}) if ObjectId.is_valid(run.get("conversation_id", "")) else None
    player = await db.players.find_one({"_id": ObjectId(run["player_id"])}) if ObjectId.is_valid(run.get("player_id", "")) else None
    if not conv:
        await db.automation_runs.update_one({"_id": run["_id"]}, {"$set": {"status": "failed", "error": "conversa não existe mais", "updated_at": now}})
        return

    start = run.get("current_node_id") or trigger_id(graph)
    ctx = await _context(run, conv, player)
    result = advance(graph, start, ctx, resume_reply=run.get("resume_reply"))
    log, error = await apply_effects(run, conv, player, result["effects"], ctx)

    status = result["status"]
    update = {
        "current_node_id": result["current"], "updated_at": datetime.now(timezone.utc),
        "resume_reply": None, "locked_until": None,
    }
    if error or status == "failed":
        update.update({"status": "failed", "error": error or result.get("error"), "completed_at": update["updated_at"]})
    elif status == "completed":
        update.update({"status": "completed", "completed_at": update["updated_at"]})
    elif result["pause"]["kind"] == "delay":
        update.update({"status": "waiting", "resume_at": update["updated_at"] + timedelta(minutes=result["pause"]["minutes"])})
    else:
        update.update({"status": "waiting_reply", "resume_at": None})
    await db.automation_runs.update_one({"_id": run["_id"]}, {
        "$set": update,
        "$push": {"visited_node_ids": {"$each": result["visited"]}, "log": {"$each": log}},
    })


async def claim_batch():
    now = datetime.now(timezone.utc)
    ready = {"$or": [
        {"status": "queued"},
        {"status": "waiting", "resume_at": {"$lte": now}},
        # Execução que travou no meio (processo caiu) volta para a fila.
        {"status": "running", "locked_until": {"$lte": now}},
    ]}
    claimed = []
    for _ in range(BATCH):
        run = await db.automation_runs.find_one_and_update(
            ready, {"$set": {"status": "running", "locked_until": now + timedelta(seconds=LOCK_SECONDS)}},
            sort=[("created_at", 1)], return_document=True,
        )
        if not run:
            break
        claimed.append(run)
    return claimed


async def worker_loop():
    while True:
        try:
            for run in await claim_batch():
                if await is_killed(run.get("workspace_id"), "automations"):
                    # Pausada, não perdida: volta a andar quando o kill switch for desligado.
                    await db.automation_runs.update_one({"_id": run["_id"]}, {"$set": {
                        "status": "waiting", "locked_until": None,
                        "resume_at": datetime.now(timezone.utc) + timedelta(seconds=60)}})
                    continue
                try:
                    await process_run(run)
                except Exception as exc:  # noqa: BLE001
                    logger.exception("execução %s falhou", run.get("_id"))
                    await db.automation_runs.update_one({"_id": run["_id"]}, {"$set": {
                        "status": "failed", "error": str(exc)[:300], "locked_until": None,
                        "completed_at": datetime.now(timezone.utc)}})
        except Exception as exc:  # noqa: BLE001 — o laço não morre
            logger.error("worker de automação: %s", exc)
        await asyncio.sleep(POLL_SECONDS)
