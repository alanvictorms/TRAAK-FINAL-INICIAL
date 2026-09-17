"""Webhooks de saída: avisa sistemas externos a cada evento da plataforma."""
import asyncio
import hashlib
import hmac
import ipaddress
import json
import logging
import socket
from datetime import datetime, timezone
from typing import Any, Dict, List
from urllib.parse import urlsplit

import httpx

logger = logging.getLogger(__name__)

EVENTS = {
    "lead.created": "Lead novo",
    "message.received": "Mensagem recebida do lead",
    "event.register": "Cadastro na casa",
    "event.ftd": "Primeiro depósito",
    "event.deposit": "Depósito",
    "event.withdrawal": "Saque",
    "dispatch.finished": "Disparo concluído",
}
TIMEOUT = 8
MAX_ATTEMPTS = 2


def public_url(url: str) -> bool:
    """Só http(s) para IP público: o servidor não vira sonda da rede interna."""
    parts = urlsplit(url or "")
    if parts.scheme not in ("http", "https") or not parts.hostname:
        return False
    try:
        infos = socket.getaddrinfo(parts.hostname, None)
    except OSError:
        return False
    return all(ipaddress.ip_address(info[4][0]).is_global for info in infos)


def sign(body: bytes, secret: str) -> str:
    return hmac.new((secret or "").encode(), body, hashlib.sha256).hexdigest()


def wants(integration: Dict[str, Any], event_type: str) -> bool:
    chosen: List[str] = (integration.get("config") or {}).get("events") or []
    return not chosen or event_type in chosen


async def emit(workspace_id: str, event_type: str, payload: Dict[str, Any]) -> None:
    """Envia o evento para cada webhook de saída ativo do workspace."""
    from database import db, is_killed
    if await is_killed(workspace_id, "webhooks"):
        return
    targets = await db.integrations.find({
        "workspace_id": workspace_id, "provider": "webhook_out",
        "status": {"$in": ["configured", "connected", "active"]},
    }).to_list(20)
    for integration in targets:
        if wants(integration, event_type):
            asyncio.create_task(_deliver(integration, event_type, payload))


async def _deliver(integration: Dict[str, Any], event_type: str, payload: Dict[str, Any]) -> None:
    from database import db
    config = integration.get("config") or {}
    credentials = integration.get("credentials") or {}
    url = config.get("callback_url") or credentials.get("callback_url")
    now = datetime.now(timezone.utc)
    delivery = {
        "workspace_id": integration["workspace_id"], "integration_id": str(integration["_id"]),
        "event": event_type, "url": url, "created_at": now,
    }
    if not url or not await asyncio.to_thread(public_url, url):
        delivery.update({"status": "failed", "error": "URL de callback inválida ou não pública"})
        await db.webhook_deliveries.insert_one(delivery)
        return
    body = json.dumps({"event": event_type, "sent_at": now.isoformat(), "data": payload},
                      default=str).encode()
    headers = {"Content-Type": "application/json", "X-Trak-Event": event_type,
               "X-Trak-Signature": sign(body, credentials.get("secret") or "")}
    if credentials.get("api_key"):
        headers["Authorization"] = f"Bearer {credentials['api_key']}"
    for attempt in range(1, MAX_ATTEMPTS + 1):
        try:
            async with httpx.AsyncClient(timeout=TIMEOUT) as client:
                response = await client.post(url, content=body, headers=headers)
            delivery.update({"status": "sent" if response.status_code < 400 else "failed",
                             "http_status": response.status_code, "attempts": attempt})
            if response.status_code < 400:
                break
        except httpx.HTTPError as exc:
            delivery.update({"status": "failed", "error": str(exc)[:200], "attempts": attempt})
        if attempt < MAX_ATTEMPTS:
            await asyncio.sleep(2)
    await db.webhook_deliveries.insert_one(delivery)
    await db.integrations.update_one({"_id": integration["_id"]}, {"$set": {
        "last_sync": now, "last_test": {"status": delivery.get("status"), "at": now}}})
