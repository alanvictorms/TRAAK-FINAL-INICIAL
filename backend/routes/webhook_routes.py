from fastapi import APIRouter, Request, HTTPException
from datetime import datetime, timezone, timedelta
from database import db
from bson import ObjectId
from messaging import ingest_incoming_message, notify
from attribution import is_start_command, membership_change, start_param
import httpx
import hashlib
import hmac
import json
import logging

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/webhooks", tags=["webhooks"])


async def _webhook_failed(workspace_id, integration_id, provider, reason):
    """Conta falhas de webhook e alerta quando se repetem (3 em 15 minutos)."""
    now = datetime.now(timezone.utc)
    await db.webhook_failures.insert_one({
        "workspace_id": workspace_id, "integration_id": integration_id,
        "provider": provider, "reason": reason, "at": now,
    })
    recent = await db.webhook_failures.count_documents({
        "workspace_id": workspace_id, "integration_id": integration_id,
        "at": {"$gte": now - timedelta(minutes=15)},
    })
    if recent >= 3:
        await notify(
            workspace_id, "webhook_failures",
            f"Webhook {provider} falhando",
            f"{recent} falhas nos últimos 15 minutos. Última: {reason}.",
            link=f"/integrations/{integration_id}",
            dedupe_key=f"webhook_failures:{integration_id}",
        )


async def _find_workspace_for_tap(api_key: str):
    """Integração TAP cuja API Key bate com a enviada. Sem chave, nenhuma."""
    if not api_key:
        return None, None
    query = {"provider": "tap", "status": {"$in": ["configured", "connected", "active"]},
             "credentials.api_key": api_key}
    integration = await db.integrations.find_one(query)
    if not integration:
        return None, None
    return integration.get("workspace_id"), integration


def _verify_signature(payload_bytes: bytes, signature: str, secret: str) -> bool:
    """Verify HMAC-SHA256 signature"""
    if not secret or not signature:
        return False
    expected = hmac.new(secret.encode(), payload_bytes, hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, signature)


@router.post("/tap")
async def tap_webhook(request: Request):
    """Rota legada: só com X-TAP-Key de uma integração existente."""
    workspace_id, integration = await _find_workspace_for_tap(request.headers.get("X-TAP-Key"))
    if not workspace_id:
        raise HTTPException(401, "Use a URL de postback da integração ou envie X-TAP-Key válida")
    return await _process_tap(request, workspace_id, integration)


@router.post("/tap/{integration_id}")
async def tap_webhook_scoped(integration_id: str, request: Request):
    """URL de postback própria da integração, autenticada pelo token dela."""
    integration = await _messaging_integration(integration_id, "tap")
    supplied = request.query_params.get("token") or request.headers.get("X-TAP-Token") or ""
    expected = (integration.get("config") or {}).get("postback_token")
    if not expected or not hmac.compare_digest(expected, supplied):
        raise HTTPException(401, "Token de postback inválido")
    return await _process_tap(request, integration["workspace_id"], integration)


async def _process_tap(request: Request, workspace_id: str, integration: dict):
    """
    Receive TAP postback events: register, ftd, deposit, withdrawal.
    
    Expected payload:
    {
      "event": "ftd" | "register" | "deposit" | "withdrawal",
      "customer_id": "player_external_id",
      "click_id": "click_correlation_id",
      "amount": 500.00,
      "currency": "BRL",
      "transaction_id": "unique_tx_id",
      "timestamp": "2026-09-16T20:00:00Z",
      "metadata": {}
    }
    """
    now = datetime.now(timezone.utc)
    payload_bytes = await request.body()

    try:
        payload = json.loads(payload_bytes)
    except json.JSONDecodeError:
        raise HTTPException(400, "Payload JSON inválido")

    # Extract event data
    event_type = payload.get("event")
    if event_type not in ("register", "ftd", "deposit", "withdrawal"):
        raise HTTPException(400, f"Tipo de evento não suportado: {event_type}")

    transaction_id = payload.get("transaction_id")
    customer_id = payload.get("customer_id")
    click_id = payload.get("click_id")
    amount = payload.get("amount")
    currency = payload.get("currency", "BRL")

    if not transaction_id:
        raise HTTPException(400, "transaction_id obrigatório")

    # Verify signature if webhook_secret is set
    signature = request.headers.get("X-TAP-Signature", "")
    webhook_secret = (integration.get("credentials") or {}).get("webhook_secret", "")
    if webhook_secret and not _verify_signature(payload_bytes, signature, webhook_secret):
        logger.warning(f"TAP webhook signature mismatch for tx={transaction_id}")
        await _webhook_failed(workspace_id, str(integration["_id"]), "TAP", "assinatura inválida")
        raise HTTPException(401, "Assinatura inválida")

    # Deduplication: check if transaction_id already exists
    existing = await db.events.find_one({
        "external_id": transaction_id,
        "workspace_id": workspace_id,
    })
    if existing:
        logger.info(f"TAP duplicate: tx={transaction_id} already exists as {existing['_id']}")
        return {
            "status": "duplicate",
            "event_id": str(existing["_id"]),
            "message": "Evento já registrado. Nenhuma duplicação.",
        }

    # Try to find player by customer_id or click_id
    person_id = None
    player = None
    if customer_id:
        player = await db.players.find_one({
            "workspace_id": workspace_id,
            "$or": [
                {"external_ids.tap_customer_id": customer_id},
                {"external_ids.customer_id": customer_id},
            ],
        })
    # O clique é buscado sempre: mesmo com o player achado pelo customer_id,
    # é dele que vem a origem do evento.
    click_event = None
    if click_id:
        click_event = await db.events.find_one({
            "workspace_id": workspace_id,
            "type": "click",
            "external_id": click_id,
        })
    if not player and click_event and click_event.get("person_id"):
        player = await db.players.find_one({"_id": ObjectId(click_event["person_id"])})

    if player:
        person_id = str(player["_id"])

    # Origem = canal de mídia que trouxe o lead (clique ou atribuição do
    # player). "tap" é o provedor do evento, não a fonte de tráfego.
    attribution = None
    if click_id and click_event:
        meta = click_event.get("metadata") or {}
        attribution = {"click_id": click_id, "link_id": meta.get("link_id"), "source": click_event.get("source"),
                       "campaign_id": meta.get("campaign_id"), "method": "last_click", "window": "30d"}
    elif player and player.get("attribution"):
        attribution = player["attribution"]
    elif click_id:
        attribution = {"click_id": click_id, "method": "last_click", "window": "30d",
                       "note": "click_id sem clique registrado"}

    # Create event in Signal Ledger
    event_status = "linked" if person_id else "orphan"
    event_doc = {
        "workspace_id": workspace_id,
        "type": event_type,
        "person_id": person_id,
        "source": (attribution or {}).get("source"),
        "value": float(amount) if amount else None,
        "currency": currency,
        "external_id": transaction_id,
        "metadata": {
            "customer_id": customer_id,
            "click_id": click_id,
            "raw_payload": payload,
            "provider": "tap",
        },
        "status": event_status,
        "latency_ms": None,
        "attempts": [{"at": now.isoformat(), "status": "received", "source": "webhook"}],
        "attribution": attribution,
        "fact_at": datetime.fromisoformat(payload["timestamp"].replace("Z", "+00:00")) if payload.get("timestamp") else now,
        "received_at": now,
        "created_at": now,
    }
    result = await db.events.insert_one(event_doc)
    event_id = str(result.inserted_id)
    link_id = (attribution or {}).get("link_id")
    if event_type == "ftd" and link_id and ObjectId.is_valid(link_id):
        await db.tracking_links.update_one({"_id": ObjectId(link_id)}, {"$inc": {"ftds": 1}})

    # Update player stats if linked
    if person_id and player:
        update_fields = {"updated_at": now}
        inc_fields = {}

        if event_type == "ftd":
            # Check if player already has FTD (dedup at player level)
            if not player.get("has_ftd"):
                update_fields["has_ftd"] = True
                update_fields["ftd_at"] = now
                update_fields["ftd_value"] = float(amount) if amount else 0
            if amount:
                inc_fields["total_deposits"] = float(amount)
        elif event_type == "deposit":
            if amount:
                inc_fields["total_deposits"] = float(amount)
        elif event_type == "withdrawal":
            if amount:
                inc_fields["total_withdrawals"] = float(amount)
        elif event_type == "register":
            update_fields["registered_at"] = now
            if customer_id:
                update_fields[f"external_ids.tap_customer_id"] = customer_id

        update_op = {"$set": update_fields}
        if inc_fields:
            update_op["$inc"] = inc_fields
        await db.players.update_one({"_id": ObjectId(person_id)}, update_op)

    # If orphan and customer_id provided, auto-create player
    if not person_id and customer_id:
        new_player = {
            "workspace_id": workspace_id,
            "name": f"TAP-{customer_id[:12]}",
            "external_ids": {"tap_customer_id": customer_id},
            "origin": "tap",
            "expert_id": None,
            "tags": [],
            "score": 0,
            "status": "active",
            "has_ftd": event_type == "ftd",
            "ftd_at": now if event_type == "ftd" else None,
            "ftd_value": float(amount) if event_type == "ftd" and amount else None,
            "total_deposits": float(amount) if event_type in ("ftd", "deposit") and amount else 0,
            "total_withdrawals": float(amount) if event_type == "withdrawal" and amount else 0,
            "registered_at": now if event_type == "register" else None,
            "created_at": now,
            "updated_at": now,
        }
        player_result = await db.players.insert_one(new_player)
        person_id = str(player_result.inserted_id)
        # Update event with person_id
        await db.events.update_one(
            {"_id": result.inserted_id},
            {"$set": {"person_id": person_id, "status": "linked"}},
        )
        event_status = "linked"

    # Update integration last_sync
    await db.integrations.update_one(
        {"_id": integration["_id"]},
        {"$set": {"last_sync": now, "status": "active"}},
    )

    # Audit
    await db.audit_log.insert_one({
        "workspace_id": workspace_id,
        "user_id": "system:tap_webhook",
        "user_email": "webhook@tap",
        "action": f"webhook.tap.{event_type}",
        "object_id": event_id,
        "object_type": "event",
        "timestamp": now,
    })

    logger.info(f"TAP webhook: {event_type} tx={transaction_id} player={person_id} status={event_status}")

    return {
        "status": "accepted",
        "event_id": event_id,
        "person_id": person_id,
        "event_status": event_status,
        "type": event_type,
    }


@router.get("/tap/health")
async def tap_webhook_health():
    """Health check for TAP webhook endpoint"""
    return {"status": "ok", "endpoint": "/api/webhooks/tap", "methods": ["POST"]}


async def _messaging_integration(integration_id: str, provider: str = None):
    if not ObjectId.is_valid(integration_id):
        raise HTTPException(404, "Integração não encontrada")
    query = {"_id": ObjectId(integration_id)}
    if provider:
        query["provider"] = provider
    integration = await db.integrations.find_one(query)
    if not integration:
        raise HTTPException(404, "Integração não encontrada")
    return integration


@router.post("/telegram/{integration_id}")
async def telegram_updates(integration_id: str, request: Request):
    """Receive Bot API updates and normalize messages into the Inbox."""
    integration = await _messaging_integration(integration_id, "telegram")
    configured_secret = (integration.get("credentials") or {}).get("webhook_secret")
    supplied_secret = request.headers.get("X-Telegram-Bot-Api-Secret-Token")
    if not configured_secret or not hmac.compare_digest(configured_secret, supplied_secret or ""):
        raise HTTPException(401, "Webhook secret inválido")

    payload = await request.json()
    logger.info(
        "Telegram update received integration=%s update_id=%s",
        integration_id,
        payload.get("update_id"),
    )
    if payload.get("chat_member"):
        return await _record_membership(integration, payload["chat_member"])

    message = (
        payload.get("message")
        or payload.get("edited_message")
        or payload.get("channel_post")
        or payload.get("edited_channel_post")
    )
    if not message:
        # Telegram retries non-2xx responses; unsupported update types are acked.
        return {"status": "ignored", "reason": "update sem mensagem"}

    sender = message.get("from") or message.get("sender_chat") or {}
    chat = message.get("chat") or {}
    external_user_id = str(sender.get("id") or chat.get("id") or "")
    external_chat_id = str(chat.get("id") or external_user_id)
    if not external_user_id or not external_chat_id:
        return {"status": "ignored", "reason": "remetente ausente"}
    sender_name = " ".join(filter(None, [sender.get("first_name"), sender.get("last_name")])).strip()
    sender_name = sender_name or sender.get("title") or sender.get("username") or f"Telegram {external_user_id}"
    content = message.get("text") or message.get("caption") or "[Mídia recebida]"
    result = await ingest_incoming_message(
        integration=integration,
        external_user_id=external_user_id,
        external_chat_id=external_chat_id,
        sender_name=sender_name,
        content=content,
        external_message_id=str(message.get("message_id") or payload.get("update_id")),
        raw_payload=payload,
    )
    if result.get("status") == "accepted" and payload.get("message") and is_start_command(content):
        await _record_bot_start(integration, result["player_id"], message, start_param(content))
    logger.info(
        "Telegram update processed integration=%s status=%s conversation=%s",
        integration_id,
        result.get("status"),
        result.get("conversation_id"),
    )
    return result


async def _click_attribution(workspace_id, token):
    """O parâmetro do /start é um click_id do redirect ou o slug de um link."""
    if not token:
        return None, None
    click = await db.events.find_one({"workspace_id": workspace_id, "type": "click", "external_id": token})
    if click:
        meta = click.get("metadata") or {}
        return click, {
            "click_id": token, "link_id": meta.get("link_id"), "source": click.get("source"),
            "campaign_id": meta.get("campaign_id"), "method": "last_click",
        }
    link = await db.tracking_links.find_one({"workspace_id": workspace_id, "slug": token.lower()})
    if link:
        return None, {
            "click_id": None, "link_id": str(link["_id"]), "source": (link.get("utm_source") or "").lower() or None,
            "campaign_id": link.get("campaign_id"), "method": "deep_link",
        }
    return None, None


async def _record_bot_start(integration, player_id, message, token):
    workspace_id = integration["workspace_id"]
    now = datetime.now(timezone.utc)
    external_id = f"tg-start-{message.get('chat', {}).get('id')}-{message.get('message_id')}"
    if await db.events.find_one({"workspace_id": workspace_id, "type": "bot_start", "external_id": external_id}):
        return
    click, attribution = await _click_attribution(workspace_id, token)
    player = await db.players.find_one({"_id": ObjectId(player_id)})
    # Primeira atribuição vence: um /start novo sem parâmetro não apaga a origem.
    attribution = attribution or (player or {}).get("attribution")
    await db.events.insert_one({
        "workspace_id": workspace_id, "type": "bot_start", "person_id": player_id,
        "source": (attribution or {}).get("source"), "value": None, "currency": None,
        "external_id": external_id,
        "metadata": {"integration_id": str(integration["_id"]), "start_param": token, "provider": "telegram"},
        "status": "linked", "attribution": attribution,
        "fact_at": now, "received_at": now, "created_at": now,
    })
    if attribution and not (player or {}).get("attribution"):
        await db.players.update_one({"_id": ObjectId(player_id)}, {"$set": {
            "attribution": attribution, "source": attribution.get("source"), "updated_at": now,
        }})
    if click and not click.get("person_id"):
        await db.events.update_one({"_id": click["_id"]}, {"$set": {"person_id": player_id, "status": "linked"}})


async def _record_membership(integration, update):
    kind = membership_change(update)
    if not kind:
        return {"status": "ignored", "reason": "mudança de membro sem entrada/saída"}
    workspace_id = integration["workspace_id"]
    member = (update.get("new_chat_member") or {}).get("user") or {}
    chat = update.get("chat") or {}
    user_id = str(member.get("id") or "")
    if not user_id or member.get("is_bot"):
        return {"status": "ignored", "reason": "membro ausente ou bot"}
    external_id = f"tg-{kind}-{chat.get('id')}-{user_id}-{update.get('date')}"
    if await db.events.find_one({"workspace_id": workspace_id, "type": kind, "external_id": external_id}):
        return {"status": "duplicate"}
    player = await db.players.find_one({"workspace_id": workspace_id, "external_ids.telegram_user_id": user_id})
    now = datetime.now(timezone.utc)
    attribution = (player or {}).get("attribution")
    await db.events.insert_one({
        "workspace_id": workspace_id, "type": kind,
        "person_id": str(player["_id"]) if player else None,
        "source": (attribution or {}).get("source"), "value": None, "currency": None,
        "external_id": external_id,
        "metadata": {
            "integration_id": str(integration["_id"]), "provider": "telegram",
            "chat_id": chat.get("id"), "chat_title": chat.get("title"), "telegram_user_id": user_id,
            "invite_link": ((update.get("invite_link") or {}).get("name")),
        },
        "status": "linked" if player else "orphan",
        "attribution": attribution,
        "fact_at": now, "received_at": now, "created_at": now,
    })
    return {"status": "accepted", "type": kind}


@router.get("/telegram/{integration_id}/health")
async def telegram_webhook_health(integration_id: str):
    await _messaging_integration(integration_id, "telegram")
    return {"status": "ok", "provider": "telegram", "integration_id": integration_id}


@router.get("/meta/{integration_id}")
async def meta_webhook_verification(integration_id: str, request: Request):
    """Meta Webhooks verification handshake (also used by WhatsApp Cloud API)."""
    integration = await _messaging_integration(integration_id)
    if integration.get("provider") not in ("meta", "whatsapp"):
        raise HTTPException(404, "Integração Meta não encontrada")
    params = request.query_params
    verify_token = (integration.get("credentials") or {}).get("verify_token") or (
        integration.get("config") or {}
    ).get("verify_token")
    if params.get("hub.mode") == "subscribe" and verify_token and hmac.compare_digest(
        params.get("hub.verify_token", ""), verify_token
    ):
        return int(params.get("hub.challenge", "0"))
    raise HTTPException(403, "Falha na verificação do webhook")


def _verify_meta_signature(body: bytes, signature: str, app_secret: str) -> bool:
    if not app_secret:
        return True
    if not signature or not signature.startswith("sha256="):
        return False
    expected = hmac.new(app_secret.encode(), body, hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, signature[7:])


@router.post("/meta/{integration_id}")
async def meta_updates(integration_id: str, request: Request):
    """Receive signed Meta webhook updates, including WhatsApp messages."""
    integration = await _messaging_integration(integration_id)
    if integration.get("provider") not in ("meta", "whatsapp"):
        raise HTTPException(404, "Integração Meta não encontrada")
    body = await request.body()
    credentials = integration.get("credentials") or {}
    app_secret = credentials.get("app_secret")
    signature = request.headers.get("X-Hub-Signature-256", "")
    if app_secret and not _verify_meta_signature(body, signature, app_secret):
        raise HTTPException(401, "Assinatura Meta inválida")
    try:
        payload = json.loads(body)
    except json.JSONDecodeError:
        raise HTTPException(400, "Payload JSON inválido")

    accepted = []
    for entry in payload.get("entry", []):
        for change in entry.get("changes", []):
            value = change.get("value") or {}
            contacts = {str(c.get("wa_id")): (c.get("profile") or {}).get("name") for c in value.get("contacts", [])}
            for message in value.get("messages", []):
                sender_id = str(message.get("from") or "")
                if not sender_id:
                    continue
                msg_type = message.get("type", "text")
                content = (message.get("text") or {}).get("body")
                if not content:
                    content = f"[{msg_type.title()} recebido]"
                accepted.append(await ingest_incoming_message(
                    integration=integration,
                    external_user_id=sender_id,
                    external_chat_id=sender_id,
                    sender_name=contacts.get(sender_id) or f"WhatsApp {sender_id}",
                    content=content,
                    external_message_id=str(message.get("id")),
                    raw_payload=message,
                ))
    return {"status": "accepted", "messages": accepted}


@router.post("/meta/{integration_id}/capi")
async def meta_capi(integration_id: str, request: Request):
    """Validate, ledger and forward one server-side conversion to Meta CAPI."""
    integration = await _messaging_integration(integration_id, "meta")
    body = await request.body()
    credentials = integration.get("credentials") or {}
    app_secret = credentials.get("app_secret")
    direct_secret = request.headers.get("X-CAPI-Secret", "")
    signature = request.headers.get("X-Hub-Signature-256", "")
    if not app_secret:
        raise HTTPException(401, "Configure o App Secret da integração Meta para aceitar eventos CAPI")
    if not (
        hmac.compare_digest(app_secret, direct_secret)
        or _verify_meta_signature(body, signature, app_secret)
    ):
        raise HTTPException(401, "Assinatura CAPI inválida")
    try:
        payload = json.loads(body)
    except json.JSONDecodeError:
        raise HTTPException(400, "Payload JSON inválido")
    event_name = payload.get("event_name")
    user_data = payload.get("user_data")
    if not event_name or not isinstance(user_data, dict) or not user_data:
        raise HTTPException(400, "event_name e user_data são obrigatórios")

    pixel_id = credentials.get("pixel_id")
    access_token = credentials.get("access_token")
    if not pixel_id or not access_token:
        raise HTTPException(400, "Pixel ID e Access Token não configurados")
    now = datetime.now(timezone.utc)
    event_id = str(payload.get("event_id") or f"capi-{int(now.timestamp() * 1000)}")
    existing = await db.events.find_one({
        "workspace_id": integration["workspace_id"],
        "source": "meta_capi",
        "external_id": event_id,
    })
    if existing:
        return {"status": "duplicate", "event_id": str(existing["_id"])}

    capi_event = {
        "event_name": event_name,
        "event_time": int(payload.get("event_time") or now.timestamp()),
        "event_id": event_id,
        "action_source": payload.get("action_source", "website"),
        "user_data": user_data,
        "custom_data": payload.get("custom_data") or {},
    }
    if payload.get("event_source_url"):
        capi_event["event_source_url"] = payload["event_source_url"]
    graph_version = (integration.get("config") or {}).get("graph_version", "v23.0")
    async with httpx.AsyncClient(timeout=20) as client:
        response = await client.post(
            f"https://graph.facebook.com/{graph_version}/{pixel_id}/events",
            params={"access_token": access_token},
            json={"data": [capi_event], **({"test_event_code": payload["test_event_code"]} if payload.get("test_event_code") else {})},
        )
    if response.status_code >= 400:
        logger.error("Meta CAPI error integration=%s response=%s", integration_id, response.text[:500])
        await _webhook_failed(integration["workspace_id"], integration_id, "Meta CAPI", f"HTTP {response.status_code}")
        raise HTTPException(502, "Meta rejeitou o evento CAPI")
    graph_response = response.json()
    event_doc = {
        "workspace_id": integration["workspace_id"],
        "type": event_name,
        "person_id": payload.get("person_id"),
        "source": "meta_capi",
        "external_id": event_id,
        "metadata": {"integration_id": integration_id, "graph_response": graph_response},
        "status": "sent",
        "fact_at": now,
        "received_at": now,
        "created_at": now,
    }
    result = await db.events.insert_one(event_doc)
    await db.integrations.update_one({"_id": integration["_id"]}, {"$set": {"last_sync": now, "status": "active"}})
    return {"status": "sent", "event_id": str(result.inserted_id), "meta": graph_response}
