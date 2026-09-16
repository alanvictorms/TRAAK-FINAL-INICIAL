from fastapi import APIRouter, Request, HTTPException
from datetime import datetime, timezone
from database import db
from bson import ObjectId
import hashlib
import hmac
import json
import logging

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/webhooks", tags=["webhooks"])


async def _find_workspace_for_tap(api_key: str = None):
    """Find workspace that has a TAP integration with matching credentials"""
    query = {"provider": "tap", "status": {"$in": ["configured", "connected", "active"]}}
    if api_key:
        query["credentials.api_key"] = api_key
    integration = await db.integrations.find_one(query)
    if not integration:
        return None, None
    return integration.get("workspace_id"), integration


def _verify_signature(payload_bytes: bytes, signature: str, secret: str) -> bool:
    """Verify HMAC-SHA256 signature"""
    if not secret or not signature:
        return True  # No secret configured = skip validation (log warning)
    expected = hmac.new(secret.encode(), payload_bytes, hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, signature)


@router.post("/tap")
async def tap_webhook(request: Request):
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

    # Find workspace by API key or first available TAP integration
    api_key_header = request.headers.get("X-TAP-Key")
    workspace_id, integration = await _find_workspace_for_tap(api_key_header)

    if not workspace_id:
        raise HTTPException(404, "Nenhuma integração TAP configurada")

    # Verify signature if webhook_secret is set
    signature = request.headers.get("X-TAP-Signature", "")
    webhook_secret = (integration.get("credentials") or {}).get("webhook_secret", "")
    if webhook_secret and not _verify_signature(payload_bytes, signature, webhook_secret):
        logger.warning(f"TAP webhook signature mismatch for tx={transaction_id}")
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
    if not player and click_id:
        # Try to find via tracking click correlation
        click_event = await db.events.find_one({
            "workspace_id": workspace_id,
            "type": "click",
            "external_id": click_id,
        })
        if click_event and click_event.get("person_id"):
            player = await db.players.find_one({"_id": ObjectId(click_event["person_id"])})

    if player:
        person_id = str(player["_id"])

    # Create event in Signal Ledger
    event_status = "linked" if person_id else "orphan"
    event_doc = {
        "workspace_id": workspace_id,
        "type": event_type,
        "person_id": person_id,
        "source": "tap",
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
        "attribution": {
            "click_id": click_id,
            "method": "last_click",
            "window": "30d",
            "note": "Referência observada, sujeita a D04",
        } if click_id else None,
        "fact_at": datetime.fromisoformat(payload["timestamp"].replace("Z", "+00:00")) if payload.get("timestamp") else now,
        "received_at": now,
        "created_at": now,
    }
    result = await db.events.insert_one(event_doc)
    event_id = str(result.inserted_id)

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
