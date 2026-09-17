"""Verificação de domínio: DNS apontando para cá e HTTPS respondendo.

Antes disso o domínio nascia 'pending_dns' e ninguém checava nada: o painel
mostrava um CNAME inventado e o status nunca mudava.
"""
import asyncio
import hashlib
import logging
import os
import socket
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional
from urllib.parse import urlsplit

import httpx

logger = logging.getLogger(__name__)

STATUS_LABELS = {
    "pending_dns": "Aguardando DNS",
    "dns_ok": "DNS apontado",
    "active": "Ativo",
    "error": "Com erro",
}
SSL_LABELS = {"pending": "Aguardando", "valid": "Válido", "error": "Com erro"}
PURPOSE_LABELS = {"tracking": "Rastreamento", "presell": "Presell", "postback": "Postback"}


def tracking_host() -> str:
    """Host para onde o cliente deve apontar o CNAME."""
    base = os.environ.get("PUBLIC_BACKEND_URL") or os.environ.get("FRONTEND_URL") or ""
    return urlsplit(base).hostname or "app.trakaquire.com"


def verify_token(workspace_id: str, domain: str) -> str:
    return hashlib.sha256(f"{workspace_id}:{domain}".encode()).hexdigest()[:24]


def expected_records(domain: str, workspace_id: str) -> List[Dict[str, str]]:
    host = tracking_host()
    return [
        {"type": "CNAME", "name": domain, "value": host,
         "hint": "Aponte o subdomínio para o nosso endereço. Na Cloudflare, deixe o proxy (nuvem laranja) ligado."},
        {"type": "TXT", "name": f"_trak.{domain}", "value": f"trak-verify={verify_token(workspace_id, domain)}",
         "hint": "Prova que o domínio é seu. Pode levar alguns minutos para propagar."},
    ]


def _resolve(host: str) -> List[str]:
    try:
        return sorted({info[4][0] for info in socket.getaddrinfo(host, None, proto=socket.IPPROTO_TCP)})
    except OSError:
        return []


async def check_domain(domain: str) -> Dict[str, Any]:
    """Resolve o domínio, compara com o nosso host e tenta o HTTPS."""
    now = datetime.now(timezone.utc)
    host = tracking_host()
    domain_ips, host_ips = await asyncio.gather(
        asyncio.to_thread(_resolve, domain), asyncio.to_thread(_resolve, host))
    dns_ok = bool(domain_ips) and bool(set(domain_ips) & set(host_ips))
    detail = []
    if not domain_ips:
        detail.append("O domínio ainda não resolve. Crie o CNAME e aguarde a propagação.")
    elif not dns_ok:
        detail.append(f"O domínio responde em {', '.join(domain_ips[:3])}, e o nosso endereço é {', '.join(host_ips[:3]) or host}.")

    https_ok, ssl_status = False, "pending"
    if domain_ips:
        try:
            async with httpx.AsyncClient(timeout=8, follow_redirects=True) as client:
                response = await client.get(f"https://{domain}/api/health")
            https_ok = response.status_code < 500
            ssl_status = "valid" if https_ok else "error"
            if not https_ok:
                detail.append(f"HTTPS respondeu {response.status_code}.")
        except httpx.HTTPError as exc:
            ssl_status = "error" if dns_ok else "pending"
            detail.append(f"HTTPS ainda não respondeu ({type(exc).__name__}).")

    status = "active" if dns_ok and https_ok else "dns_ok" if dns_ok else "pending_dns"
    return {
        "status": status, "ssl_status": ssl_status, "dns_ok": dns_ok, "https_ok": https_ok,
        "resolved_ips": domain_ips, "target_ips": host_ips, "target_host": host,
        "detail": " ".join(detail) or "Domínio apontado e respondendo por HTTPS.",
        "checked_at": now,
    }
