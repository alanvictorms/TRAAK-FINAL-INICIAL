"""Telegram webhook registration utilities.

The Bot API embeds the bot token in the request path. Callers must keep httpx
request logging above INFO so credentials are never written to runtime logs.
"""

from datetime import datetime, timezone
from typing import Any, Dict, Optional
from urllib.parse import urlsplit, urlunsplit
import logging
import os

import httpx
from bson import ObjectId

from database import db


logger = logging.getLogger(__name__)


def public_api_base(request=None) -> str:
    """Return the externally reachable HTTPS origin, including proxy setups."""
    configured = os.environ.get("PUBLIC_BACKEND_URL") or os.environ.get("FRONTEND_URL")
    if configured:
        return configured.rstrip("/")

    if request is None:
        raise ValueError("PUBLIC_BACKEND_URL ou FRONTEND_URL não configurada")
    forwarded_proto = request.headers.get("x-forwarded-proto", "").split(",")[0].strip()
    forwarded_host = request.headers.get("x-forwarded-host", "").split(",")[0].strip()
    parts = urlsplit(str(request.base_url))
    scheme = forwarded_proto or parts.scheme
    host = forwarded_host or parts.netloc
    if scheme == "http" and host.split(":")[0] not in ("localhost", "127.0.0.1"):
        scheme = "https"
    return urlunsplit((scheme, host, parts.path.rstrip("/"), "", ""))


def telegram_webhook_url(integration_id: str, request=None) -> str:
    return f"{public_api_base(request)}/api/webhooks/telegram/{integration_id}"


async def register_telegram_webhook(
    integration: Dict[str, Any], request=None
) -> Dict[str, Any]:
    integration_id = str(integration["_id"])
    credentials = integration.get("credentials") or {}
    bot_token = credentials.get("bot_token")
    webhook_secret = credentials.get("webhook_secret")
    if not bot_token:
        return {"status": "error", "detail": "Bot Token ausente"}
    if not webhook_secret:
        return {"status": "error", "detail": "Webhook Secret ausente"}

    try:
        webhook_url = telegram_webhook_url(integration_id, request)
    except ValueError as exc:
        return {"status": "error", "detail": str(exc)}

    oid: Optional[ObjectId] = ObjectId(integration_id) if ObjectId.is_valid(integration_id) else None
    try:
        async with httpx.AsyncClient(timeout=15) as http:
            response = await http.post(
                f"https://api.telegram.org/bot{bot_token}/setWebhook",
                json={
                    "url": webhook_url,
                    "secret_token": webhook_secret,
                    # chat_member: entradas e saídas do canal (exige o bot como admin do canal).
                    "allowed_updates": ["message", "edited_message", "channel_post", "edited_channel_post", "chat_member"],
                    "drop_pending_updates": False,
                },
            )
        data = response.json()
        if response.status_code >= 400 or not data.get("ok"):
            detail = data.get("description", "Telegram rejeitou o webhook")
            raise RuntimeError(detail)
    except (httpx.HTTPError, ValueError, RuntimeError) as exc:
        detail = str(exc)
        if oid:
            await db.integrations.update_one(
                {"_id": oid},
                {"$set": {
                    "status": "error",
                    "webhook_error": detail,
                    "config.webhook_url": webhook_url,
                    "updated_at": datetime.now(timezone.utc),
                }},
            )
        logger.warning("Telegram webhook registration failed integration=%s error=%s", integration_id, detail)
        return {"status": "error", "detail": detail, "webhook_url": webhook_url}

    now = datetime.now(timezone.utc)
    if oid:
        await db.integrations.update_one(
            {"_id": oid},
            {
                "$set": {
                    "status": "active",
                    "config.webhook_url": webhook_url,
                    "webhook_registered_at": now,
                    "updated_at": now,
                },
                "$unset": {"webhook_error": ""},
            },
        )
    logger.info("Telegram webhook registered integration=%s", integration_id)
    return {"status": "registered", "webhook_url": webhook_url}


async def sync_telegram_webhooks() -> None:
    """Repair missing/stale webhook registrations without blocking app startup."""
    integrations = await db.integrations.find({
        "provider": "telegram",
        "status": {"$in": ["configured", "active", "error"]},
        "credentials.bot_token": {"$exists": True, "$ne": ""},
    }).to_list(100)
    for integration in integrations:
        await register_telegram_webhook(integration)
