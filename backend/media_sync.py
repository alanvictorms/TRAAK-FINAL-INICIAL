"""Traz campanhas e investimento do Meta Ads para dentro da plataforma.

Antes disso a integração do Meta só guardava credenciais: nenhuma campanha
entrava, e o investimento ficava sempre zerado.
"""
import logging
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional

import httpx

logger = logging.getLogger(__name__)

GRAPH = "https://graph.facebook.com/v21.0"
TIMEOUT = 25
STATUS_MAP = {"ACTIVE": "active", "PAUSED": "paused", "DELETED": "archived", "ARCHIVED": "archived"}


def account_id(credentials: Dict[str, Any]) -> Optional[str]:
    raw = str(credentials.get("ad_account_id") or "").strip()
    if not raw:
        return None
    return raw if raw.startswith("act_") else f"act_{raw}"


def to_float(value) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return 0.0


def merge_insights(campaigns: List[Dict[str, Any]], insights: List[Dict[str, Any]]):
    """Junta a campanha com o total gasto e o gasto de cada dia."""
    totals: Dict[str, Dict[str, float]] = {}
    daily: Dict[str, List[Dict[str, Any]]] = {}
    for row in insights:
        cid = row.get("campaign_id")
        if not cid:
            continue
        bucket = totals.setdefault(cid, {"spend": 0.0, "impressions": 0, "clicks": 0})
        bucket["spend"] += to_float(row.get("spend"))
        bucket["impressions"] += int(to_float(row.get("impressions")))
        bucket["clicks"] += int(to_float(row.get("clicks")))
        if row.get("date_start"):
            daily.setdefault(cid, []).append({
                "date": row["date_start"], "spend": to_float(row.get("spend")),
                "impressions": int(to_float(row.get("impressions"))), "clicks": int(to_float(row.get("clicks")))})
    merged = []
    for campaign in campaigns:
        cid = campaign.get("id")
        stats = totals.get(cid, {"spend": 0.0, "impressions": 0, "clicks": 0})
        merged.append({
            "external_id": cid,
            "name": campaign.get("name") or cid,
            "status": STATUS_MAP.get(campaign.get("status"), "paused"),
            "budget": to_float(campaign.get("daily_budget") or campaign.get("lifetime_budget")) / 100,
            "spend": round(stats["spend"], 2),
            "impressions": stats["impressions"],
            "clicks": stats["clicks"],
            "daily": daily.get(cid, []),
        })
    return merged


async def _get(client: httpx.AsyncClient, path: str, params: Dict[str, Any]) -> List[Dict[str, Any]]:
    """Segue a paginação do Graph até acabar (no máximo 10 páginas)."""
    out: List[Dict[str, Any]] = []
    url = f"{GRAPH}/{path}"
    for _ in range(10):
        response = await client.get(url, params=params)
        if response.status_code >= 400:
            detail = (response.json().get("error") or {}).get("message") if "json" in response.headers.get("content-type", "") else response.text
            raise RuntimeError(f"Meta respondeu {response.status_code}: {str(detail)[:200]}")
        payload = response.json()
        out.extend(payload.get("data") or [])
        nxt = (payload.get("paging") or {}).get("next")
        if not nxt:
            break
        url, params = nxt, {}
    return out


async def fetch_meta(credentials: Dict[str, Any], days: int = 30) -> List[Dict[str, Any]]:
    account = account_id(credentials)
    token = credentials.get("access_token")
    if not account or not token:
        raise RuntimeError("Faltam o Ad Account ID e o Access Token na integração")
    since = (datetime.now(timezone.utc) - timedelta(days=days)).strftime("%Y-%m-%d")
    until = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    async with httpx.AsyncClient(timeout=TIMEOUT) as client:
        campaigns = await _get(client, f"{account}/campaigns", {
            "fields": "id,name,status,daily_budget,lifetime_budget", "limit": 200, "access_token": token})
        insights = await _get(client, f"{account}/insights", {
            "level": "campaign", "fields": "campaign_id,spend,impressions,clicks",
            "time_increment": 1, "time_range": f'{{"since":"{since}","until":"{until}"}}',
            "limit": 500, "access_token": token})
    return merge_insights(campaigns, insights)


async def sync_integration(integration: Dict[str, Any], days: int = 30) -> Dict[str, Any]:
    """Grava as campanhas do Meta no workspace da integração."""
    from database import db
    ws_id = integration["workspace_id"]
    rows = await fetch_meta(integration.get("credentials") or {}, days)
    now = datetime.now(timezone.utc)
    for row in rows:
        await db.campaigns.update_one(
            {"workspace_id": ws_id, "platform": "meta", "external_id": row["external_id"]},
            {"$set": {
                "name": row["name"], "status": row["status"], "budget": row["budget"],
                "metrics.spend": row["spend"], "metrics.impressions": row["impressions"],
                "metrics.clicks": row["clicks"], "source": "meta", "integration_id": str(integration["_id"]),
                "last_sync": now, "updated_at": now,
            }, "$setOnInsert": {"created_at": now, "expert_id": None}},
            upsert=True)
        for day in row["daily"]:
            await db.campaign_daily.update_one(
                {"workspace_id": ws_id, "external_id": row["external_id"], "date": day["date"]},
                {"$set": {**day, "platform": "meta", "updated_at": now}}, upsert=True)
    await db.integrations.update_one({"_id": integration["_id"]}, {"$set": {
        "last_sync": now, "status": "active", "last_test": {"status": "success", "tested_at": now},
        "sync_error": None}})
    return {"integration": integration.get("name"), "campaigns": len(rows),
            "spend": round(sum(r["spend"] for r in rows), 2)}


async def sync_workspace(workspace_id: str, days: int = 30) -> Dict[str, Any]:
    from database import db
    results, errors = [], []
    async for integration in db.integrations.find({"workspace_id": workspace_id, "provider": "meta"}):
        try:
            results.append(await sync_integration(integration, days))
        except Exception as exc:  # noqa: BLE001 — uma conta quebrada não para as outras
            await db.integrations.update_one({"_id": integration["_id"]}, {"$set": {
                "status": "error", "sync_error": str(exc)[:300],
                "last_test": {"status": "error", "tested_at": datetime.now(timezone.utc)}}})
            errors.append({"integration": integration.get("name"), "error": str(exc)[:300]})
    return {"synced": results, "errors": errors}


async def sync_all(days: int = 7) -> None:
    """Chamado pelo monitor: mantém o investimento em dia sem ninguém clicar."""
    from database import db
    async for integration in db.integrations.find({"provider": "meta", "status": {"$ne": "available"}}):
        try:
            await sync_integration(integration, days)
        except Exception as exc:  # noqa: BLE001
            logger.warning("sync do Meta falhou (%s): %s", integration.get("name"), exc)
            await db.integrations.update_one({"_id": integration["_id"]}, {"$set": {
                "status": "error", "sync_error": str(exc)[:300]}})
