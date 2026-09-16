from fastapi import APIRouter, HTTPException, Request
from datetime import datetime, timezone
from bson import ObjectId
from database import db
from auth import get_current_user, require_admin
from models import (
    AIProviderCreate, AIProviderUpdate, TenantCreate, PlanCreate,
    TeamMemberInvite, APIKeyCreate, WorkspaceSettingsUpdate,
)
import math
import secrets

router = APIRouter(prefix="/api", tags=["platform"])


# ── Platform Admin ──
@router.get("/platform")
async def platform_overview(request: Request):
    user = await require_admin(request)
    tenants = await db.workspaces.count_documents({})
    users_count = await db.users.count_documents({})
    events_count = await db.events.count_documents({})
    return {
        "tenants": tenants,
        "users": users_count,
        "events": events_count,
        "ai_providers": await db.ai_providers.count_documents({}),
    }


@router.get("/platform/tenants")
async def list_tenants(request: Request, search: str = None, page: int = 1, limit: int = 50):
    await require_admin(request)
    query = {}
    if search:
        query["name"] = {"$regex": search, "$options": "i"}
    total = await db.workspaces.count_documents(query)
    items = await db.workspaces.find(query).sort("created_at", -1).skip((page - 1) * limit).limit(limit).to_list(limit)
    for item in items:
        item["_id"] = str(item["_id"])
    return {"items": items, "total": total, "page": page, "pages": math.ceil(total / limit) if total else 1}


@router.post("/platform/tenants")
async def create_tenant(body: TenantCreate, request: Request):
    await require_admin(request)
    now = datetime.now(timezone.utc)
    ws = {
        "name": body.name,
        "slug": body.name.lower().replace(" ", "-"),
        "timezone": "America/Sao_Paulo",
        "currency": "BRL",
        "plan": body.plan,
        "environment": body.environment,
        "modules": {
            "tracking": True, "identity": True, "automations": True,
            "inbox": True, "ledger": True, "reports": True,
            "financeiro": True, "campaigns": True, "segments": True, "disparos": True,
        },
        "onboarding_completed": False,
        "created_at": now,
    }
    result = await db.workspaces.insert_one(ws)
    ws["_id"] = str(result.inserted_id)
    return ws


# ── AI Providers ──
@router.get("/platform/ai")
async def list_ai_providers(request: Request):
    await require_admin(request)
    items = await db.ai_providers.find({}).sort("created_at", -1).to_list(100)
    for item in items:
        item["_id"] = str(item["_id"])
        if "api_key" in item:
            item["api_key_masked"] = item["api_key"][:8] + "••••••" if len(item.get("api_key", "")) > 8 else "••••••"
            del item["api_key"]
    return {"items": items}


@router.post("/platform/ai")
async def create_ai_provider(body: AIProviderCreate, request: Request):
    await require_admin(request)
    now = datetime.now(timezone.utc)
    doc = {
        "name": body.name,
        "provider": body.provider,
        "model": body.model,
        "api_key": body.api_key,
        "status": body.status,
        "config": body.config,
        "calls": 0,
        "cost": 0,
        "created_at": now,
        "updated_at": now,
    }
    result = await db.ai_providers.insert_one(doc)
    doc["_id"] = str(result.inserted_id)
    doc["api_key_masked"] = doc["api_key"][:8] + "••••••"
    del doc["api_key"]
    return doc


@router.put("/platform/ai/{provider_id}")
async def update_ai_provider(provider_id: str, body: AIProviderUpdate, request: Request):
    await require_admin(request)
    update = {"updated_at": datetime.now(timezone.utc)}
    if body.name is not None:
        update["name"] = body.name
    if body.model is not None:
        update["model"] = body.model
    if body.api_key is not None:
        update["api_key"] = body.api_key
    if body.status is not None:
        update["status"] = body.status
    if body.config is not None:
        update["config"] = body.config
    result = await db.ai_providers.update_one({"_id": ObjectId(provider_id)}, {"$set": update})
    if result.matched_count == 0:
        raise HTTPException(404, "Provedor não encontrado")
    return {"detail": "Atualizado"}


@router.delete("/platform/ai/{provider_id}")
async def delete_ai_provider(provider_id: str, request: Request):
    await require_admin(request)
    result = await db.ai_providers.delete_one({"_id": ObjectId(provider_id)})
    if result.deleted_count == 0:
        raise HTTPException(404, "Provedor não encontrado")
    return {"detail": "Removido"}


# ── Plans ──
@router.get("/platform/plans")
async def list_plans(request: Request):
    await require_admin(request)
    items = await db.plans.find({}).sort("created_at", -1).to_list(100)
    for item in items:
        item["_id"] = str(item["_id"])
    return {"items": items}


@router.post("/platform/plans")
async def create_plan(body: PlanCreate, request: Request):
    await require_admin(request)
    doc = {
        "name": body.name,
        "price": body.price,
        "currency": body.currency,
        "features": body.features,
        "limits": body.limits,
        "version": 1,
        "created_at": datetime.now(timezone.utc),
    }
    result = await db.plans.insert_one(doc)
    doc["_id"] = str(result.inserted_id)
    return doc


# ── Settings ──
@router.get("/settings/general")
async def get_workspace_settings(request: Request):
    user = await get_current_user(request)
    ws = await db.workspaces.find_one({"_id": ObjectId(user["workspace_id"])})
    if not ws:
        raise HTTPException(404, "Workspace não encontrado")
    ws["_id"] = str(ws["_id"])
    return ws


@router.put("/settings/general")
async def update_workspace_settings(body: WorkspaceSettingsUpdate, request: Request):
    user = await get_current_user(request)
    update = {"updated_at": datetime.now(timezone.utc)}
    if body.name is not None:
        update["name"] = body.name
    if body.timezone is not None:
        update["timezone"] = body.timezone
    if body.currency is not None:
        update["currency"] = body.currency
    if body.modules is not None:
        update["modules"] = body.modules
    result = await db.workspaces.update_one(
        {"_id": ObjectId(user["workspace_id"])},
        {"$set": update},
    )
    if result.matched_count == 0:
        raise HTTPException(404, "Workspace não encontrado")
    return {"detail": "Atualizado"}


# ── Team ──
@router.get("/settings/team")
async def list_team(request: Request):
    user = await get_current_user(request)
    members = await db.users.find(
        {"workspace_id": user["workspace_id"]},
        {"password_hash": 0},
    ).to_list(200)
    for m in members:
        m["_id"] = str(m["_id"])
    invites = await db.invites.find({"workspace_id": user["workspace_id"]}).to_list(100)
    for i in invites:
        i["_id"] = str(i["_id"])
    return {"members": members, "invites": invites}


@router.post("/settings/team/invite")
async def invite_member(body: TeamMemberInvite, request: Request):
    user = await get_current_user(request)
    token = secrets.token_urlsafe(32)
    now = datetime.now(timezone.utc)
    doc = {
        "workspace_id": user["workspace_id"],
        "email": body.email.strip().lower(),
        "role": body.role,
        "token": token,
        "status": "pending",
        "invited_by": user["_id"],
        "created_at": now,
        "expires_at": datetime.now(timezone.utc).__class__(
            now.year, now.month, now.day + 7, tzinfo=timezone.utc
        ) if now.day <= 24 else now,
    }
    result = await db.invites.insert_one(doc)
    doc["_id"] = str(result.inserted_id)
    return doc


# ── API Keys ──
@router.get("/settings/api")
async def list_api_keys(request: Request):
    user = await get_current_user(request)
    items = await db.api_keys.find(
        {"workspace_id": user["workspace_id"]},
        {"key_hash": 0},
    ).to_list(100)
    for item in items:
        item["_id"] = str(item["_id"])
    return {"items": items}


@router.post("/settings/api")
async def create_api_key(body: APIKeyCreate, request: Request):
    user = await get_current_user(request)
    key = f"tk_{secrets.token_urlsafe(32)}"
    now = datetime.now(timezone.utc)
    doc = {
        "workspace_id": user["workspace_id"],
        "name": body.name,
        "scopes": body.scopes,
        "key_prefix": key[:12],
        "key_hash": key,  # In production would be hashed
        "status": "active",
        "created_at": now,
        "created_by": user["_id"],
    }
    result = await db.api_keys.insert_one(doc)
    doc["_id"] = str(result.inserted_id)
    doc["key"] = key  # Show full key only on creation
    return doc


@router.delete("/settings/api/{key_id}")
async def revoke_api_key(key_id: str, request: Request):
    user = await get_current_user(request)
    result = await db.api_keys.update_one(
        {"_id": ObjectId(key_id), "workspace_id": user["workspace_id"]},
        {"$set": {"status": "revoked", "revoked_at": datetime.now(timezone.utc)}},
    )
    if result.matched_count == 0:
        raise HTTPException(404, "Chave não encontrada")
    return {"detail": "Chave revogada"}


# ── Notifications ──
@router.get("/notifications")
async def list_notifications(request: Request, page: int = 1, limit: int = 20):
    user = await get_current_user(request)
    query = {"user_id": user["_id"]}
    total = await db.notifications.count_documents(query)
    items = await db.notifications.find(query).sort("created_at", -1).skip((page - 1) * limit).limit(limit).to_list(limit)
    for item in items:
        item["_id"] = str(item["_id"])
    unread = await db.notifications.count_documents({**query, "read": False})
    return {"items": items, "total": total, "unread": unread}


@router.post("/notifications/mark-read")
async def mark_notifications_read(request: Request):
    user = await get_current_user(request)
    await db.notifications.update_many({"user_id": user["_id"], "read": False}, {"$set": {"read": True}})
    return {"detail": "Notificações marcadas como lidas"}


# ── Audit Log ──
@router.get("/settings/audit")
async def list_audit_log(request: Request, page: int = 1, limit: int = 50):
    user = await get_current_user(request)
    query = {"workspace_id": user["workspace_id"]}
    total = await db.audit_log.count_documents(query)
    items = await db.audit_log.find(query).sort("timestamp", -1).skip((page - 1) * limit).limit(limit).to_list(limit)
    for item in items:
        item["_id"] = str(item["_id"])
    return {"items": items, "total": total, "page": page, "pages": math.ceil(total / limit) if total else 1}


# ── Analytics ──
@router.get("/analytics")
async def get_analytics(request: Request, period: str = "30d"):
    user = await get_current_user(request)
    ws_id = user["workspace_id"]
    pipeline = [
        {"$match": {"workspace_id": ws_id}},
        {"$group": {
            "_id": {"type": "$type", "source": "$source"},
            "count": {"$sum": 1},
            "total_value": {"$sum": {"$ifNull": ["$value", 0]}},
        }},
    ]
    agg = await db.events.aggregate(pipeline).to_list(100)
    by_source = {}
    for item in agg:
        src = item["_id"].get("source") or "direct"
        if src not in by_source:
            by_source[src] = {"source": src, "clicks": 0, "registrations": 0, "ftds": 0, "deposits": 0, "value": 0}
        t = item["_id"].get("type")
        if t == "click":
            by_source[src]["clicks"] += item["count"]
        elif t == "register":
            by_source[src]["registrations"] += item["count"]
        elif t == "ftd":
            by_source[src]["ftds"] += item["count"]
            by_source[src]["value"] += item["total_value"]
        elif t == "deposit":
            by_source[src]["deposits"] += item["count"]
            by_source[src]["value"] += item["total_value"]
    return {"items": list(by_source.values()), "period": period}


@router.get("/analytics/atendimento")
async def get_atendimento_analytics(request: Request):
    user = await get_current_user(request)
    ws_id = user["workspace_id"]
    pipeline = [
        {"$match": {"workspace_id": ws_id}},
        {"$group": {
            "_id": "$assigned_to",
            "conversations": {"$sum": 1},
            "resolved": {"$sum": {"$cond": [{"$eq": ["$status", "resolved"]}, 1, 0]}},
        }},
    ]
    agg = await db.conversations.aggregate(pipeline).to_list(50)
    total_queue = await db.conversations.count_documents({"workspace_id": ws_id, "status": "queue"})
    total_active = await db.conversations.count_documents({"workspace_id": ws_id, "status": "active"})
    return {"by_agent": agg, "queue": total_queue, "active": total_active}
