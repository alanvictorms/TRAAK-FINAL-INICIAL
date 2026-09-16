from fastapi import APIRouter, HTTPException, Request, Query
from datetime import datetime, timezone
from bson import ObjectId
from database import db
from auth import get_current_user
from models import IntegrationCreate, IntegrationUpdate, DomainCreate, DomainUpdate, TrackingLinkCreate
import math

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
    return doc


@router.post("/integrations")
async def create_integration(body: IntegrationCreate, request: Request):
    user = await get_current_user(request)
    now = datetime.now(timezone.utc)
    doc = {
        "workspace_id": user["workspace_id"],
        "provider": body.provider,
        "category": body.category,
        "name": body.name,
        "status": "configured" if body.credentials else "available",
        "credentials": body.credentials,
        "capabilities": body.capabilities,
        "config": body.config,
        "last_sync": None,
        "last_test": None,
        "created_at": now,
        "updated_at": now,
        "created_by": user["_id"],
    }
    result = await db.integrations.insert_one(doc)
    doc["_id"] = str(result.inserted_id)
    await _audit(user, "integration.create", str(result.inserted_id), "integration")
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


@router.get("/tracking/sources")
async def list_sources(request: Request):
    user = await get_current_user(request)
    pipeline = [
        {"$match": {"workspace_id": user["workspace_id"]}},
        {"$group": {
            "_id": "$utm_source",
            "links": {"$sum": 1},
            "clicks": {"$sum": "$clicks"},
            "ftds": {"$sum": "$ftds"},
        }},
        {"$sort": {"clicks": -1}},
    ]
    items = await db.tracking_links.aggregate(pipeline).to_list(100)
    for item in items:
        item["source"] = item.pop("_id") or "direct"
    return {"items": items}


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


async def _audit(user, action, object_id, object_type):
    await db.audit_log.insert_one({
        "workspace_id": user.get("workspace_id"),
        "user_id": user["_id"],
        "user_email": user.get("email", ""),
        "action": action,
        "object_id": object_id,
        "object_type": object_type,
        "timestamp": datetime.now(timezone.utc),
    })
