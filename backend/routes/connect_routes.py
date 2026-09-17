from fastapi import APIRouter, HTTPException, Request, Query
from datetime import datetime, timezone
from bson import ObjectId
from database import db, audit as _audit
from auth import get_current_user
from models import IntegrationCreate, IntegrationUpdate, DomainCreate, DomainUpdate, TrackingLinkCreate
from telegram_service import public_api_base, register_telegram_webhook
import math
import secrets

router = APIRouter(prefix="/api", tags=["connect"])


# ── Integrations ──
@router.get("/integrations")
async def list_integrations(request: Request, category: str = None, status: str = None, search: str = None, page: int = 1, limit: int = 50):
    user = await get_current_user(request)
    query = {"workspace_id": user["workspace_id"]}
    if category:
        query["category"] = category
    if status:
        query["status"] = status
    if search:
        query["name"] = {"$regex": search, "$options": "i"}
    total = await db.integrations.count_documents(query)
    items = await db.integrations.find(query).sort("name", 1).skip((page - 1) * limit).limit(limit).to_list(limit)
    for item in items:
        item["_id"] = str(item["_id"])
        # Mask credentials
        if "credentials" in item:
            item["credentials"] = {k: "••••••" for k in item.get("credentials", {})}
    return {"items": items, "total": total, "page": page, "pages": math.ceil(total / limit) if total else 1}


@router.get("/integrations/{integration_id}")
async def get_integration(integration_id: str, request: Request):
    user = await get_current_user(request)
    doc = await db.integrations.find_one({"_id": ObjectId(integration_id), "workspace_id": user["workspace_id"]})
    if not doc:
        raise HTTPException(404, "Integração não encontrada")
    doc["_id"] = str(doc["_id"])
    if "credentials" in doc:
        doc["credentials_masked"] = {k: "••••••" for k in doc.get("credentials", {})}
        doc.pop("credentials", None)
    return doc


@router.post("/integrations")
async def create_integration(body: IntegrationCreate, request: Request):
    user = await get_current_user(request)
    now = datetime.now(timezone.utc)
    config = dict(body.config)
    credentials = dict(body.credentials)
    if body.provider == "telegram":
        credentials["webhook_secret"] = secrets.token_urlsafe(24)
    doc = {
        "workspace_id": user["workspace_id"],
        "provider": body.provider,
        "category": body.category,
        "name": body.name,
        "status": "configured" if body.credentials else "available",
        "credentials": credentials,
        "capabilities": body.capabilities,
        "config": config,
        "last_sync": None,
        "last_test": None,
        "created_at": now,
        "updated_at": now,
        "created_by": user["_id"],
    }
    result = await db.integrations.insert_one(doc)
    doc["_id"] = str(result.inserted_id)
    base_url = public_api_base(request)
    if body.provider == "telegram":
        config.update({
            "webhook_url": f"{base_url}/api/webhooks/telegram/{doc['_id']}",
        })
    elif body.provider in ("meta", "whatsapp"):
        config["webhook_url"] = f"{base_url}/api/webhooks/meta/{doc['_id']}"
        if body.provider == "meta":
            config["capi_url"] = f"{base_url}/api/webhooks/meta/{doc['_id']}/capi"
    if config != body.config:
        await db.integrations.update_one({"_id": result.inserted_id}, {"$set": {"config": config}})
        doc["config"] = config
    webhook_registration = None
    if body.provider == "telegram":
        registration_doc = {**doc, "_id": result.inserted_id, "credentials": credentials, "config": config}
        webhook_registration = await register_telegram_webhook(registration_doc, request)
        doc["status"] = "active" if webhook_registration["status"] == "registered" else "error"
    await _audit(user, "integration.create", str(result.inserted_id), "integration")
    doc["credentials"] = {k: "••••••" for k in credentials}
    if webhook_registration:
        doc["webhook_registration"] = webhook_registration
    return doc


@router.put("/integrations/{integration_id}")
async def update_integration(integration_id: str, body: IntegrationUpdate, request: Request):
    user = await get_current_user(request)
    update = {"updated_at": datetime.now(timezone.utc)}
    if body.name is not None:
        update["name"] = body.name
    if body.status is not None:
        update["status"] = body.status
    if body.credentials is not None:
        update["credentials"] = body.credentials
        if body.credentials:
            update["status"] = "configured"
    if body.config is not None:
        update["config"] = body.config
    result = await db.integrations.update_one(
        {"_id": ObjectId(integration_id), "workspace_id": user["workspace_id"]},
        {"$set": update},
    )
    if result.matched_count == 0:
        raise HTTPException(404, "Integração não encontrada")
    await _audit(user, "integration.update", integration_id, "integration")
    return {"detail": "Atualizado"}


@router.delete("/integrations/{integration_id}")
async def delete_integration(integration_id: str, request: Request):
    user = await get_current_user(request)
    result = await db.integrations.delete_one({"_id": ObjectId(integration_id), "workspace_id": user["workspace_id"]})
    if result.deleted_count == 0:
        raise HTTPException(404, "Integração não encontrada")
    await _audit(user, "integration.delete", integration_id, "integration")
    return {"detail": "Removido"}


@router.post("/integrations/{integration_id}/test")
async def test_integration(integration_id: str, request: Request):
    user = await get_current_user(request)
    doc = await db.integrations.find_one({"_id": ObjectId(integration_id), "workspace_id": user["workspace_id"]})
    if not doc:
        raise HTTPException(404, "Integração não encontrada")
    now = datetime.now(timezone.utc)
    test_result = {"status": "success" if doc.get("credentials") else "no_credentials", "tested_at": now.isoformat(), "tested_by": user["_id"]}
    await db.integrations.update_one({"_id": ObjectId(integration_id)}, {"$set": {"last_test": test_result, "updated_at": now}})
    return test_result


@router.post("/integrations/{integration_id}/webhook/register")
async def register_integration_webhook(integration_id: str, request: Request):
    """Register the generated callback with providers that expose a registration API."""
    user = await get_current_user(request)
    if not ObjectId.is_valid(integration_id):
        raise HTTPException(404, "Integração não encontrada")
    doc = await db.integrations.find_one({"_id": ObjectId(integration_id), "workspace_id": user["workspace_id"]})
    if not doc:
        raise HTTPException(404, "Integração não encontrada")
    if doc.get("provider") != "telegram":
        raise HTTPException(400, "Este provedor não exige registro automático de webhook")
    result = await register_telegram_webhook(doc, request)
    if result["status"] != "registered":
        raise HTTPException(502, result["detail"])
    return result


# ── Domains ──
@router.get("/domains")
async def list_domains(request: Request, search: str = None, page: int = 1, limit: int = 50):
    user = await get_current_user(request)
    query = {"workspace_id": user["workspace_id"]}
    if search:
        query["domain"] = {"$regex": search, "$options": "i"}
    total = await db.domains.count_documents(query)
    items = await db.domains.find(query).sort("created_at", -1).skip((page - 1) * limit).limit(limit).to_list(limit)
    for item in items:
        item["_id"] = str(item["_id"])
    return {"items": items, "total": total, "page": page, "pages": math.ceil(total / limit) if total else 1}


@router.get("/domains/{domain_id}")
async def get_domain(domain_id: str, request: Request):
    user = await get_current_user(request)
    doc = await db.domains.find_one({"_id": ObjectId(domain_id), "workspace_id": user["workspace_id"]})
    if not doc:
        raise HTTPException(404, "Domínio não encontrado")
    doc["_id"] = str(doc["_id"])
    return doc


@router.post("/domains")
async def create_domain(body: DomainCreate, request: Request):
    user = await get_current_user(request)
    now = datetime.now(timezone.utc)
    existing = await db.domains.find_one({"domain": body.domain, "workspace_id": user["workspace_id"]})
    if existing:
        raise HTTPException(400, "Domínio já cadastrado")
    doc = {
        "workspace_id": user["workspace_id"],
        "domain": body.domain,
        "purpose": body.purpose,
        "status": "pending_dns",
        "ssl_status": "pending",
        "dns_records": [],
        "clicks_30d": 0,
        "last_check": None,
        "created_at": now,
        "updated_at": now,
    }
    result = await db.domains.insert_one(doc)
    doc["_id"] = str(result.inserted_id)
    return doc


@router.delete("/domains/{domain_id}")
async def delete_domain(domain_id: str, request: Request):
    user = await get_current_user(request)
    result = await db.domains.delete_one({"_id": ObjectId(domain_id), "workspace_id": user["workspace_id"]})
    if result.deleted_count == 0:
        raise HTTPException(404, "Domínio não encontrado")
    return {"detail": "Removido"}


# ── Tracking Links ──
@router.get("/tracking")
async def list_tracking_links(request: Request, search: str = None, status: str = None, page: int = 1, limit: int = 50):
    user = await get_current_user(request)
    query = {"workspace_id": user["workspace_id"]}
    if search:
        query["$or"] = [{"name": {"$regex": search, "$options": "i"}}, {"slug": {"$regex": search, "$options": "i"}}]
    if status:
        query["status"] = status
    total = await db.tracking_links.count_documents(query)
    items = await db.tracking_links.find(query).sort("created_at", -1).skip((page - 1) * limit).limit(limit).to_list(limit)
    for item in items:
        item["_id"] = str(item["_id"])
    return {"items": items, "total": total, "page": page, "pages": math.ceil(total / limit) if total else 1}


# Aliases que chegam em utm_source / campaign.platform / event.source.
SOURCE_ALIASES = {
    "facebook": "meta", "fb": "meta", "instagram": "meta", "ig": "meta", "meta": "meta",
    "tiktok": "tiktok", "tt": "tiktok",
    "google": "google", "adwords": "google", "gads": "google", "youtube": "google",
    "kwai": "kwai",
}

# Parâmetros dinâmicos oficiais de cada plataforma. Kwai fica sem template:
# não publicamos macro que não conseguimos confirmar.
SOURCE_MACROS = {
    "meta": "utm_source=meta&utm_medium=paid&utm_campaign={{campaign.name}}&utm_content={{ad.name}}&utm_term={{adset.name}}",
    "tiktok": "utm_source=tiktok&utm_medium=paid&utm_campaign=__CAMPAIGN_NAME__&utm_content=__CID_NAME__&utm_term=__AID_NAME__",
    "google": "utm_source=google&utm_medium=paid&utm_campaign={campaignid}&utm_content={creative}&utm_term={keyword}",
}


def normalize_source(value):
    key = (value or "").strip().lower()
    if not key:
        return "direct"
    return SOURCE_ALIASES.get(key, key)


@router.get("/tracking/sources")
async def list_sources(request: Request):
    """Uma linha por fonte: links, cliques e FTDs do ledger, investimento das campanhas."""
    user = await get_current_user(request)
    ws_id = user["workspace_id"]
    rows = {}

    def row(src):
        return rows.setdefault(src, {
            "source": src, "macro": SOURCE_MACROS.get(src), "links": 0,
            "clicks": 0, "ftds": 0, "ftd_value": 0.0, "spend": 0.0,
        })

    links = await db.tracking_links.aggregate([
        {"$match": {"workspace_id": ws_id}},
        {"$group": {"_id": "$utm_source", "links": {"$sum": 1}}},
    ]).to_list(500)
    for item in links:
        row(normalize_source(item["_id"]))["links"] += item["links"]

    # O ledger é a fonte da verdade para cliques e FTDs.
    events = await db.events.aggregate([
        {"$match": {"workspace_id": ws_id, "type": {"$in": ["click", "ftd"]}}},
        {"$group": {
            "_id": {"source": "$source", "type": "$type"},
            "count": {"$sum": 1},
            "value": {"$sum": {"$ifNull": ["$value", 0]}},
        }},
    ]).to_list(1000)
    for item in events:
        r = row(normalize_source(item["_id"].get("source")))
        if item["_id"]["type"] == "click":
            r["clicks"] += item["count"]
        else:
            r["ftds"] += item["count"]
            r["ftd_value"] += item["value"]

    spend = await db.campaigns.aggregate([
        {"$match": {"workspace_id": ws_id}},
        {"$group": {"_id": "$platform", "spend": {"$sum": {"$ifNull": ["$metrics.spend", 0]}}}},
    ]).to_list(100)
    for item in spend:
        row(normalize_source(item["_id"]))["spend"] += item["spend"]

    items = []
    for r in rows.values():
        # Sem FTD não existe CPFTD: None, nunca 0.
        r["cpftd"] = round(r["spend"] / r["ftds"], 2) if r["ftds"] else None
        items.append(r)
    items.sort(key=lambda r: (r["spend"], r["clicks"]), reverse=True)

    totals = {k: sum(r[k] for r in items) for k in ("links", "clicks", "ftds", "spend")}
    totals["cpftd"] = round(totals["spend"] / totals["ftds"], 2) if totals["ftds"] else None
    return {"items": items, "totals": totals}


@router.get("/tracking/{link_id}")
async def get_tracking_link(link_id: str, request: Request):
    user = await get_current_user(request)
    doc = await db.tracking_links.find_one({"_id": ObjectId(link_id), "workspace_id": user["workspace_id"]})
    if not doc:
        raise HTTPException(404, "Link não encontrado")
    doc["_id"] = str(doc["_id"])
    return doc


@router.post("/tracking")
async def create_tracking_link(body: TrackingLinkCreate, request: Request):
    user = await get_current_user(request)
    now = datetime.now(timezone.utc)
    # Check slug uniqueness within workspace
    existing = await db.tracking_links.find_one({"slug": body.slug, "workspace_id": user["workspace_id"]})
    if existing:
        raise HTTPException(400, "Slug já utilizado neste workspace")
    doc = {
        "workspace_id": user["workspace_id"],
        "name": body.name,
        "slug": body.slug,
        "destination": body.destination,
        "domain_id": body.domain_id,
        "utm_source": body.utm_source,
        "utm_medium": body.utm_medium,
        "utm_campaign": body.utm_campaign,
        "utm_content": body.utm_content,
        "utm_term": body.utm_term,
        "expert_id": body.expert_id,
        "campaign_id": body.campaign_id,
        "ab_variants": body.ab_variants,
        "rules": body.rules,
        "status": "active",
        "clicks": 0,
        "ftds": 0,
        "created_at": now,
        "updated_at": now,
    }
    result = await db.tracking_links.insert_one(doc)
    doc["_id"] = str(result.inserted_id)
    return doc


@router.delete("/tracking/{link_id}")
async def delete_tracking_link(link_id: str, request: Request):
    user = await get_current_user(request)
    result = await db.tracking_links.delete_one({"_id": ObjectId(link_id), "workspace_id": user["workspace_id"]})
    if result.deleted_count == 0:
        raise HTTPException(404, "Link não encontrado")
    return {"detail": "Removido"}


