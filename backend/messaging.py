"""Channel adapters plus normalized inbound-message persistence."""

from datetime import datetime, timezone
from typing import Any, Dict, Optional
import logging

import httpx
from bson import ObjectId

from database import db
from realtime import inbox_events


logger = logging.getLogger(__name__)


def _oid(value: str) -> Optional[ObjectId]:
    try:
        return ObjectId(value)
    except Exception:
        return None


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
    automations = await db.automations.find(query).to_list(100)
    now = datetime.now(timezone.utc)
    for automation in automations:
        run_key = f"{automation['_id']}:{message_id}"
        existing = await db.automation_runs.find_one({"run_key": run_key})
        if existing:
            continue
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
            "nodes": automation.get("nodes", []),
            "edges": automation.get("edges", []),
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

    await _start_automations(
        workspace_id, integration_id, conversation_id, message_id, str(player["_id"])
    )
    await inbox_events.publish(workspace_id, {
        "type": "message.received",
        "conversation_id": conversation_id,
        "message_id": message_id,
        "channel": provider,
    })
    return {"status": "accepted", "conversation_id": conversation_id, "message_id": message_id}
