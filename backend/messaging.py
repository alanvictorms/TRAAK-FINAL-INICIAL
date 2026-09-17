"""Channel adapters plus normalized inbound-message persistence."""

from datetime import datetime, timezone, timedelta
from typing import Any, Dict, Optional
import logging

import httpx
from bson import ObjectId

from database import db
from realtime import inbox_events
from segments import is_opt_out


logger = logging.getLogger(__name__)


def _oid(value: str) -> Optional[ObjectId]:
    try:
        return ObjectId(value)
    except Exception:
        return None


NOTIFICATION_DEFAULTS = {
    "channels": {"inapp": True, "email": True, "telegram": False},
    "digest": "daily",
    "critical": {
        "integration_down": True,
        "webhook_failures": True,
        "ftd_drop": True,
        "budget_exceeded": True,
        "approval_pending": True,
    },
    "telegram_chat_id": "",
}
DIGEST_OPTIONS = {"off", "hourly", "daily", "weekly"}


def merge_notification_settings(saved: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    saved = saved or {}
    return {
        "channels": {**NOTIFICATION_DEFAULTS["channels"], **(saved.get("channels") or {})},
        "digest": saved.get("digest", NOTIFICATION_DEFAULTS["digest"]),
        "critical": {**NOTIFICATION_DEFAULTS["critical"], **(saved.get("critical") or {})},
        "telegram_chat_id": saved.get("telegram_chat_id", ""),
    }


async def notify(
    workspace_id: str,
    kind: str,
    title: str,
    body: str = "",
    link: Optional[str] = None,
    dedupe_key: Optional[str] = None,
    dedupe_minutes: int = 60,
    user_ids: Optional[list] = None,
) -> int:
    """Entrega uma notificação nos canais ativos do workspace.

    Respeita as preferências de Configurações > Notificações: alerta crítico
    desligado não é gravado nem enviado. `dedupe_key` impede que o mesmo alerta
    se repita dentro da janela — um webhook falhando cem vezes vira um aviso.
    Devolve quantos destinatários receberam no app.
    """
    oid = _oid(workspace_id)
    if not oid:
        return 0
    ws = await db.workspaces.find_one({"_id": oid}, {"notification_settings": 1})
    prefs = merge_notification_settings((ws or {}).get("notification_settings"))
    if kind in prefs["critical"] and not prefs["critical"][kind]:
        return 0

    now = datetime.now(timezone.utc)
    if dedupe_key:
        recent = await db.notifications.find_one({
            "workspace_id": workspace_id,
            "dedupe_key": dedupe_key,
            "created_at": {"$gte": now - timedelta(minutes=dedupe_minutes)},
        })
        if recent:
            return 0

    delivered = 0
    if prefs["channels"]["inapp"]:
        query = {"workspace_id": workspace_id}
        if user_ids:
            query["_id"] = {"$in": [ObjectId(u) for u in user_ids if ObjectId.is_valid(u)]}
        users = await db.users.find(query, {"_id": 1}).to_list(500)
        docs = [{
            "workspace_id": workspace_id,
            "user_id": str(u["_id"]),
            "kind": kind,
            "title": title,
            "body": body,
            "link": link,
            "dedupe_key": dedupe_key,
            "read": False,
            "created_at": now,
        } for u in users]
        if docs:
            await db.notifications.insert_many(docs)
            delivered = len(docs)

    # E-mail: a plataforma ainda não tem provedor de envio configurado. O
    # canal fica salvo na preferência, mas nada sai por ele — sem fingir.
    chat_id = prefs["telegram_chat_id"]
    if prefs["channels"]["telegram"] and chat_id:
        integration = await db.integrations.find_one({
            "workspace_id": workspace_id,
            "provider": "telegram",
            "credentials.bot_token": {"$exists": True, "$ne": ""},
        })
        token = ((integration or {}).get("credentials") or {}).get("bot_token")
        if token:
            try:
                async with httpx.AsyncClient(timeout=10) as client:
                    response = await client.post(
                        f"https://api.telegram.org/bot{token}/sendMessage",
                        json={"chat_id": chat_id, "text": f"{title}\n{body}".strip()},
                    )
                    response.raise_for_status()
            except Exception as exc:  # noqa: BLE001 — alerta não pode derrubar quem alerta
                logger.warning("notify telegram falhou workspace=%s: %s", workspace_id, exc)
    return delivered


async def send_channel_message(conversation: Dict[str, Any], content: str) -> Dict[str, Any]:
    """Send a reply through the connection that owns the conversation."""
    integration_id = conversation.get("integration_id")
    oid = _oid(integration_id) if integration_id else None
    if not oid:
        # Legacy/manual conversations have no provider connection.
        return {"status": "stored_only"}

    integration = await db.integrations.find_one({
        "_id": oid,
        "workspace_id": conversation.get("workspace_id"),
    })
    if not integration:
        raise ValueError("Conexão da conversa não encontrada")

    credentials = integration.get("credentials") or {}
    provider = integration.get("provider")
    async with httpx.AsyncClient(timeout=15) as client:
        if provider == "telegram":
            token = credentials.get("bot_token")
            chat_id = conversation.get("external_chat_id")
            if not token or not chat_id:
                raise ValueError("Telegram sem token ou chat vinculado")
            response = await client.post(
                f"https://api.telegram.org/bot{token}/sendMessage",
                json={"chat_id": chat_id, "text": content},
            )
            response.raise_for_status()
            result = response.json().get("result") or {}
            return {"status": "sent", "external_id": str(result.get("message_id", ""))}

        if provider == "whatsapp":
            phone_number_id = credentials.get("phone_number_id")
            access_token = credentials.get("access_token")
            recipient = conversation.get("external_chat_id")
            if not phone_number_id or not access_token or not recipient:
                raise ValueError("WhatsApp sem credenciais ou destinatário vinculado")
            response = await client.post(
                f"https://graph.facebook.com/v23.0/{phone_number_id}/messages",
                headers={"Authorization": f"Bearer {access_token}"},
                json={
                    "messaging_product": "whatsapp",
                    "to": recipient,
                    "type": "text",
                    "text": {"body": content},
                },
            )
            response.raise_for_status()
            data = response.json()
            external_id = ((data.get("messages") or [{}])[0]).get("id", "")
            return {"status": "sent", "external_id": external_id}

    raise ValueError(f"Envio não suportado para {provider}")


async def _start_automations(
    workspace_id: str,
    integration_id: str,
    conversation_id: str,
    message_id: str,
    player_id: str,
) -> None:
    """Create auditable executions for active flows bound to this connection.

    The persisted graph is interpreted by downstream workers. Creating the run
    synchronously guarantees every inbound lead enters each matching flow once.
    """
    query = {
        "workspace_id": workspace_id,
        "status": "active",
        "connection_id": integration_id,
        "trigger.event": {"$in": ["message_received", "incoming_message"]},
    }
    now = datetime.now(timezone.utc)

    # Resposta a um menu: retoma a execução que esperava por ela.
    waiting = await db.automation_runs.find(
        {"workspace_id": workspace_id, "conversation_id": conversation_id, "status": "waiting_reply"}
    ).to_list(20)
    for run in waiting:
        message = await db.messages.find_one({"_id": ObjectId(message_id)}, {"content": 1})
        await db.automation_runs.update_one({"_id": run["_id"], "status": "waiting_reply"}, {"$set": {
            "status": "queued", "resume_reply": (message or {}).get("content", ""), "updated_at": now}})

    automations = await db.automations.find(query).to_list(100)
    for automation in automations:
        # Uma execução por fluxo por conversa. Antes cada mensagem do lead
        # disparava o fluxo de novo — a boas-vindas saía a cada "oi".
        if await db.automation_runs.find_one({"automation_id": str(automation["_id"]), "conversation_id": conversation_id}):
            continue
        published = automation.get("published") or {}
        run_key = f"{automation['_id']}:{message_id}"
        await db.automation_runs.insert_one({
            "run_key": run_key,
            "workspace_id": workspace_id,
            "automation_id": str(automation["_id"]),
            "connection_id": integration_id,
            "conversation_id": conversation_id,
            "player_id": player_id,
            "trigger_message_id": message_id,
            "status": "queued",
            "current_node_id": None,
            # A execução carrega a versão publicada: editar o rascunho não muda
            # quem já está no fluxo.
            "version": published.get("version"),
            "nodes": published.get("nodes", automation.get("nodes", [])),
            "edges": published.get("edges", automation.get("edges", [])),
            "created_at": now,
            "updated_at": now,
        })
        await db.automations.update_one(
            {"_id": automation["_id"]},
            {"$inc": {"executions": 1}, "$set": {"last_execution_at": now}},
        )


async def ingest_incoming_message(
    *,
    integration: Dict[str, Any],
    external_user_id: str,
    external_chat_id: str,
    sender_name: str,
    content: str,
    external_message_id: str,
    raw_payload: Dict[str, Any],
) -> Dict[str, Any]:
    """Normalize a provider update into player, conversation and message docs."""
    workspace_id = integration["workspace_id"]
    integration_id = str(integration["_id"])
    provider = integration["provider"]
    now = datetime.now(timezone.utc)

    duplicate = await db.messages.find_one({
        "workspace_id": workspace_id,
        "integration_id": integration_id,
        "external_id": external_message_id,
    })
    if duplicate:
        return {"status": "duplicate", "message_id": str(duplicate["_id"])}

    external_key = f"external_ids.{provider}_user_id"
    player = await db.players.find_one({"workspace_id": workspace_id, external_key: external_user_id})
    if not player:
        external_ids = {f"{provider}_user_id": external_user_id}
        if provider == "telegram":
            telegram_message = raw_payload.get("message") or raw_payload.get("edited_message") or raw_payload.get("channel_post") or {}
            telegram_sender = telegram_message.get("from") or telegram_message.get("sender_chat") or {}
            if telegram_sender.get("username"):
                external_ids["telegram_username"] = telegram_sender["username"]
        player_doc = {
            "workspace_id": workspace_id,
            "name": sender_name or f"{provider.title()} {external_user_id}",
            "external_ids": external_ids,
            "origin": provider,
            "tags": [],
            "score": 0,
            "status": "active",
            "has_ftd": False,
            "total_deposits": 0,
            "total_withdrawals": 0,
            "created_at": now,
            "updated_at": now,
            "last_seen_at": now,
        }
        result = await db.players.insert_one(player_doc)
        player_doc["_id"] = result.inserted_id
        player = player_doc
    else:
        await db.players.update_one({"_id": player["_id"]}, {"$set": {"updated_at": now, "last_seen_at": now}})

    conversation = await db.conversations.find_one({
        "workspace_id": workspace_id,
        "integration_id": integration_id,
        "external_chat_id": external_chat_id,
        "status": {"$ne": "resolved"},
    })
    if not conversation:
        conversation_doc = {
            "workspace_id": workspace_id,
            "player_id": str(player["_id"]),
            "player_name": player.get("name") or sender_name,
            "channel": provider,
            "integration_id": integration_id,
            "integration_name": integration.get("name", provider.title()),
            "external_chat_id": external_chat_id,
            "subject": f"Conversa via {integration.get('name', provider.title())}",
            "status": "queue",
            "assigned_to": None,
            "assigned_name": None,
            "tags": [],
            "unread_count": 0,
            "created_at": now,
            "updated_at": now,
        }
        result = await db.conversations.insert_one(conversation_doc)
        conversation_doc["_id"] = result.inserted_id
        conversation = conversation_doc

    conversation_id = str(conversation["_id"])
    message_doc = {
        "conversation_id": conversation_id,
        "workspace_id": workspace_id,
        "integration_id": integration_id,
        "external_id": external_message_id,
        "sender_id": external_user_id,
        "sender_name": sender_name,
        "content": content or "[Mensagem sem texto]",
        "type": "incoming",
        "direction": "inbound",
        "raw_payload": raw_payload,
        "created_at": now,
    }
    result = await db.messages.insert_one(message_doc)
    message_id = str(result.inserted_id)
    await db.conversations.update_one(
        {"_id": conversation["_id"]},
        {"$set": {"updated_at": now, "last_message": message_doc["content"][:100]}, "$inc": {"unread_count": 1}},
    )
    await db.integrations.update_one(
        {"_id": integration["_id"]},
        {"$set": {"last_sync": now, "status": "active"}},
    )

    if is_opt_out(content):
        await db.suppressions.update_one(
            {"workspace_id": workspace_id, "provider": provider, "contact": str(external_chat_id)},
            {"$setOnInsert": {"reason": "opt-out do lead", "created_at": now}},
            upsert=True,
        )
    await _start_automations(
        workspace_id, integration_id, conversation_id, message_id, str(player["_id"])
    )
    try:
        from webhooks_out import emit as emit_webhook
        await emit_webhook(workspace_id, "message.received", {
            "conversation_id": conversation_id, "player_id": str(player["_id"]),
            "player_name": player.get("name"), "channel": provider, "content": content})
    except Exception as exc:  # noqa: BLE001 — webhook do cliente não derruba a mensagem
        logger.warning("webhook de saída falhou: %s", exc)
    try:
        from ai_agent import on_incoming
        await on_incoming(conversation, player, content or "")
    except Exception as exc:  # noqa: BLE001 — a mensagem do lead não se perde por causa da IA
        logger.warning("agente de IA não respondeu: %s", exc)
    await inbox_events.publish(workspace_id, {
        "type": "message.received",
        "conversation_id": conversation_id,
        "message_id": message_id,
        "channel": provider,
    })
    return {
        "status": "accepted",
        "conversation_id": conversation_id,
        "message_id": message_id,
        "player_id": str(player["_id"]),
    }


FTD_DROP_MIN_DAILY_AVG = 5    # abaixo disso a média é ruído, não sinal
FTD_DROP_RATIO = 0.5          # últimas 24h abaixo de metade da média diária


def ftd_dropped(last_day: int, previous_week: int) -> bool:
    """Últimas 24h abaixo da metade da média diária da semana anterior."""
    daily_avg = previous_week / 7
    return daily_avg >= FTD_DROP_MIN_DAILY_AVG and last_day < daily_avg * FTD_DROP_RATIO


async def run_monitors() -> None:
    """Alertas que não nascem de uma requisição: orçamento e queda de FTD."""
    now = datetime.now(timezone.utc)
    async for ws in db.workspaces.find({}, {"_id": 1}):
        ws_id = str(ws["_id"])

        async for camp in db.campaigns.find({
            "workspace_id": ws_id,
            "budget": {"$gt": 0},
            "$expr": {"$gt": ["$metrics.spend", "$budget"]},
        }):
            await notify(
                ws_id, "budget_exceeded",
                f"Orçamento estourado: {camp.get('name')}",
                f"Investido {camp['metrics']['spend']:.2f} de {camp['budget']:.2f}.",
                link=f"/media/{camp['_id']}",
                dedupe_key=f"budget_exceeded:{camp['_id']}",
                dedupe_minutes=24 * 60,
            )

        last_day = await db.events.count_documents({
            "workspace_id": ws_id, "type": "ftd",
            "created_at": {"$gte": now - timedelta(days=1)},
        })
        previous_week = await db.events.count_documents({
            "workspace_id": ws_id, "type": "ftd",
            "created_at": {"$gte": now - timedelta(days=8), "$lt": now - timedelta(days=1)},
        })
        if ftd_dropped(last_day, previous_week):
            daily_avg = previous_week / 7
            await notify(
                ws_id, "ftd_drop",
                "Queda brusca de FTDs",
                f"{last_day} FTDs nas últimas 24h contra média de {daily_avg:.1f}/dia na semana anterior.",
                link="/analytics",
                dedupe_key="ftd_drop",
                dedupe_minutes=24 * 60,
            )


async def recheck_domains() -> None:
    """Revê os domínios que ainda não estão ativos, e os ativos de hora em hora."""
    from domains_check import check_domain, expected_records
    now = datetime.now(timezone.utc)
    async for doc in db.domains.find({"$or": [
        {"status": {"$ne": "active"}},
        {"last_check": {"$lte": now - timedelta(hours=1)}},
    ]}).limit(30):
        result = await check_domain(doc["domain"])
        if result["status"] != doc.get("status"):
            await notify(doc["workspace_id"], "domain_status",
                         f"Domínio {doc['domain']}: {result['status']}", result["detail"],
                         link="/domains", dedupe_key=f"domain:{doc['_id']}")
        await db.domains.update_one({"_id": doc["_id"]}, {"$set": {
            "status": result["status"], "ssl_status": result["ssl_status"],
            "last_check": result["checked_at"], "last_check_detail": result["detail"],
            "dns_records": expected_records(doc["domain"], doc["workspace_id"])}})
        await db.domain_checks.insert_one({"domain_id": str(doc["_id"]), "workspace_id": doc["workspace_id"], **result})


async def monitor_loop(interval_seconds: int = 900) -> None:
    import asyncio
    while True:
        try:
            await run_monitors()
        except Exception as exc:  # noqa: BLE001 — o laço não pode morrer por um workspace
            logger.error("monitor falhou: %s", exc)
        try:
            await recheck_domains()
        except Exception as exc:  # noqa: BLE001
            logger.error("verificação de domínios: %s", exc)
        try:
            from routes.prove_routes import run_due_reports
            await run_due_reports()
        except Exception as exc:  # noqa: BLE001
            logger.error("relatórios agendados falharam: %s", exc)
        await asyncio.sleep(interval_seconds)
