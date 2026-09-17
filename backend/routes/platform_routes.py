from fastapi import APIRouter, HTTPException, Request
from datetime import datetime, timezone, timedelta
from bson import ObjectId
from database import db, audit
from messaging import NOTIFICATION_DEFAULTS, DIGEST_OPTIONS, merge_notification_settings
from analytics import (
    CLOSE_REASONS, buckets, funnel_steps, pct_change, ratio, resolve_period,
    response_minutes, workspace_tz,
)
from attribution import normalize_source, source_variants
from auth import get_current_user, require_admin
from models import (
    AIProviderCreate, AIProviderUpdate, TenantCreate, PlanCreate,
    TeamMemberInvite, APIKeyCreate, WorkspaceSettingsUpdate,
)
import math
import re
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
        "expires_at": now + timedelta(days=7),
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


@router.post("/notifications/{notification_id}/read")
async def mark_notification_read(notification_id: str, request: Request):
    user = await get_current_user(request)
    if not ObjectId.is_valid(notification_id):
        raise HTTPException(404, "Notificação não encontrada")
    await db.notifications.update_one(
        {"_id": ObjectId(notification_id), "user_id": user["_id"]},
        {"$set": {"read": True}},
    )
    return {"detail": "Lida"}


@router.post("/notifications/mark-read")
async def mark_notifications_read(request: Request):
    user = await get_current_user(request)
    await db.notifications.update_many({"user_id": user["_id"], "read": False}, {"$set": {"read": True}})
    return {"detail": "Notificações marcadas como lidas"}


# ── Notification settings ──
async def _load_notification_settings(ws_id):
    ws = await db.workspaces.find_one({"_id": ObjectId(ws_id)}, {"notification_settings": 1})
    return merge_notification_settings((ws or {}).get("notification_settings"))


@router.get("/settings/notifications")
async def get_notification_settings(request: Request):
    user = await get_current_user(request)
    return await _load_notification_settings(user["workspace_id"])


@router.put("/settings/notifications")
async def update_notification_settings(request: Request):
    user = await get_current_user(request)
    body = await request.json()
    current = await _load_notification_settings(user["workspace_id"])

    for group in ("channels", "critical"):
        for key, value in (body.get(group) or {}).items():
            if key not in NOTIFICATION_DEFAULTS[group]:
                raise HTTPException(400, f"Opção desconhecida: {group}.{key}")
            if not isinstance(value, bool):
                raise HTTPException(400, f"{group}.{key} deve ser verdadeiro ou falso")
            current[group][key] = value
    if "digest" in body:
        if body["digest"] not in DIGEST_OPTIONS:
            raise HTTPException(400, "Resumo deve ser off, hourly, daily ou weekly")
        current["digest"] = body["digest"]
    if "telegram_chat_id" in body:
        current["telegram_chat_id"] = str(body["telegram_chat_id"] or "").strip()
    if current["channels"]["telegram"] and not current["telegram_chat_id"]:
        raise HTTPException(400, "Informe o chat ID do Telegram para ativar esse canal")

    now = datetime.now(timezone.utc)
    await db.workspaces.update_one(
        {"_id": ObjectId(user["workspace_id"])},
        {"$set": {"notification_settings": current, "updated_at": now}},
    )
    await audit(user, "notification_settings.update", user["workspace_id"], "workspace")
    return current


# ── Billing ──
USAGE_METRICS = {
    "events_month": "Eventos no mês",
    "players": "Players",
    "members": "Membros",
    "integrations": "Integrações",
    "tracking_links": "Links de tracking",
}


@router.get("/settings/billing")
async def get_billing(request: Request):
    user = await get_current_user(request)
    ws_id = user["workspace_id"]
    ws = await db.workspaces.find_one({"_id": ObjectId(ws_id)}) or {}

    plan = None
    plan_ref = ws.get("plan_id") or ws.get("plan")
    if plan_ref:
        if ObjectId.is_valid(str(plan_ref)):
            query = {"_id": ObjectId(str(plan_ref))}
        else:
            query = {"name": {"$regex": f"^{re.escape(str(plan_ref))}$", "$options": "i"}}
        plan = await db.plans.find_one(query)
        if plan:
            plan["_id"] = str(plan["_id"])

    now = datetime.now(timezone.utc)
    month_start = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    used = {
        "events_month": await db.events.count_documents({"workspace_id": ws_id, "created_at": {"$gte": month_start}}),
        "players": await db.players.count_documents({"workspace_id": ws_id}),
        "members": await db.users.count_documents({"workspace_id": ws_id}),
        "integrations": await db.integrations.count_documents({"workspace_id": ws_id}),
        "tracking_links": await db.tracking_links.count_documents({"workspace_id": ws_id}),
    }
    limits = (plan or {}).get("limits") or {}
    # Limite ausente no plano = None; a tela escreve "sem limite", não 0.
    usage = [
        {"key": key, "label": label, "used": used[key], "limit": limits.get(key)}
        for key, label in USAGE_METRICS.items()
    ]

    invoices = await db.invoices.find({"workspace_id": ws_id}).sort("issued_at", -1).to_list(24)
    for inv in invoices:
        inv["_id"] = str(inv["_id"])

    return {
        "plan": plan,
        "plan_label": (plan or {}).get("name") or ws.get("plan"),
        "period_start": month_start,
        "usage": usage,
        "invoices": invoices,
        "currency": ws.get("currency", "BRL"),
    }


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


# ── Busca global ──
# (coleção, rótulo, campos pesquisados, campo exibido, rota da tela)
SEARCH_TARGETS = [
    ("players", "Players", ["name", "tags"], "name", "/players/{id}"),
    ("conversations", "Conversas", ["player_name", "subject", "tags"], "player_name", "/inbox/{id}"),
    ("tracking_links", "Links", ["name", "slug"], "name", "/tracking/{id}"),
    ("campaigns", "Campanhas", ["name"], "name", "/media/{id}"),
    ("automations", "Automações", ["name"], "name", "/automations/{id}"),
    ("segments", "Segmentos", ["name"], "name", "/segments"),
    ("integrations", "Integrações", ["name", "provider"], "name", "/integrations/{id}"),
    ("domains", "Domínios", ["domain"], "domain", "/domains/{id}"),
    ("reports", "Relatórios", ["name"], "name", "/reports"),
]


@router.get("/search")
async def global_search(request: Request, q: str = "", limit: int = 5):
    user = await get_current_user(request)
    term = q.strip()
    if len(term) < 2:
        return {"query": term, "groups": []}
    # Entrada do usuário vira texto literal, nunca expressão regular.
    pattern = {"$regex": re.escape(term), "$options": "i"}
    limit = max(1, min(limit, 10))
    groups = []
    for collection, label, fields, display, route in SEARCH_TARGETS:
        query = {"workspace_id": user["workspace_id"], "$or": [{f: pattern} for f in fields]}
        docs = await db[collection].find(query, {display: 1, "status": 1}).limit(limit).to_list(limit)
        if docs:
            groups.append({
                "type": collection,
                "label": label,
                "items": [{
                    "id": str(d["_id"]),
                    "title": d.get(display) or "(sem nome)",
                    "status": d.get("status"),
                    "link": route.format(id=str(d["_id"])),
                } for d in docs],
            })
    return {"query": term, "groups": groups}


# ── Analytics ──
KPI_CATALOG = {
    "clicks": "Cliques",
    "bot_starts": "StartBots",
    "channel_joins": "Entradas no canal",
    "registrations": "Cadastros",
    "ftds": "FTDs",
    "ftd_value": "Valor em FTD",
    "deposits_value": "Depósitos",
    "net_deposits": "Depósito líquido",
    "click_to_ftd": "Clique → FTD (%)",
    "avg_ftd": "Ticket médio do FTD",
}
DEFAULT_KPIS = ["clicks", "registrations", "ftds", "deposits_value"]
COUNT_KEYS = {"click": "clicks", "bot_start": "bot_starts", "channel_join": "channel_joins",
              "register": "registrations", "ftd": "ftds"}


def _event_match(ws_id, start, end, source):
    match = {"workspace_id": ws_id, "created_at": {"$gte": start, "$lt": end}}
    if source:
        match["source"] = {"$in": source_variants(normalize_source(source))}
    return match


def _totals(rows):
    """rows: [{_id: type, count, value}] → KPIs do catálogo."""
    by_type = {r["_id"]: r for r in rows}
    out = {COUNT_KEYS[t]: by_type.get(t, {}).get("count", 0) for t in COUNT_KEYS}
    ftd_value = by_type.get("ftd", {}).get("value", 0) or 0
    deposits = (by_type.get("deposit", {}).get("value", 0) or 0) + ftd_value
    withdrawals = by_type.get("withdrawal", {}).get("value", 0) or 0
    out.update({
        "ftd_value": ftd_value,
        "deposits_value": deposits,
        "net_deposits": deposits - withdrawals,
        "click_to_ftd": ratio(out["ftds"], out["clicks"], pct=True),
        "avg_ftd": ratio(ftd_value, out["ftds"]),
    })
    return out


async def _window(ws_id, start, end, source):
    rows = await db.events.aggregate([
        {"$match": _event_match(ws_id, start, end, source)},
        {"$group": {"_id": "$type", "count": {"$sum": 1}, "value": {"$sum": {"$ifNull": ["$value", 0]}}}},
    ]).to_list(50)
    return _totals(rows)


async def _series(ws_id, start, end, source, granularity, tz):
    unit = {"$dateTrunc": {"date": "$created_at", "unit": granularity, "timezone": tz.key if hasattr(tz, "key") else "UTC"}}
    if granularity == "week":
        unit["$dateTrunc"]["startOfWeek"] = "monday"
    rows = await db.events.aggregate([
        {"$match": _event_match(ws_id, start, end, source)},
        {"$group": {"_id": {"t": unit, "type": "$type"}, "count": {"$sum": 1},
                    "value": {"$sum": {"$ifNull": ["$value", 0]}}}},
    ]).to_list(5000)
    grouped = {}
    for r in rows:
        grouped.setdefault(r["_id"]["t"], []).append({"_id": r["_id"]["type"], "count": r["count"], "value": r["value"]})
    points = []
    for b in buckets(start, end, granularity, tz):
        totals = _totals(grouped.get(b, []))
        points.append({"t": b, **{k: totals[k] for k in ("clicks", "bot_starts", "channel_joins", "registrations", "ftds", "deposits_value")}})
    return points


@router.get("/analytics/overview")
async def analytics_overview(request: Request, period: str = "30d", granularity: str = "day", source: str = None):
    user = await get_current_user(request)
    ws_id = user["workspace_id"]
    ws = await db.workspaces.find_one({"_id": ObjectId(ws_id)}, {"timezone": 1, "currency": 1}) or {}
    tz = workspace_tz(ws.get("timezone"))
    try:
        prev_start, start, end = resolve_period(period)
        series = await _series(ws_id, start, end, source, granularity, tz)
        previous_series = await _series(ws_id, prev_start, start, source, granularity, tz)
    except ValueError as exc:
        raise HTTPException(400, str(exc))

    current = await _window(ws_id, start, end, source)
    previous = await _window(ws_id, prev_start, start, source)
    kpis = [{
        "key": key, "label": label, "value": current[key], "previous": previous[key],
        "change": pct_change(current[key], previous[key]),
    } for key, label in KPI_CATALOG.items()]

    # Série anterior alinhada por posição (o 3º dia de agora com o 3º de antes).
    for i, point in enumerate(series):
        prev = previous_series[i] if i < len(previous_series) else {}
        point["previous"] = {k: prev.get(k, 0) for k in ("clicks", "registrations", "ftds", "deposits_value")}

    by_source_rows = await db.events.aggregate([
        {"$match": _event_match(ws_id, start, end, source)},
        {"$group": {"_id": {"source": "$source", "type": "$type"}, "count": {"$sum": 1},
                    "value": {"$sum": {"$ifNull": ["$value", 0]}}}},
    ]).to_list(1000)
    per_source = {}
    for r in by_source_rows:
        key = normalize_source(r["_id"].get("source"))
        per_source.setdefault(key, []).append({"_id": r["_id"]["type"], "count": r["count"], "value": r["value"]})
    by_source = []
    for key, rows in per_source.items():
        # Mesmo tipo pode vir de aliases diferentes (facebook, meta): soma antes.
        merged = {}
        for row in rows:
            m = merged.setdefault(row["_id"], {"_id": row["_id"], "count": 0, "value": 0})
            m["count"] += row["count"]
            m["value"] += row["value"]
        by_source.append({"source": key, **_totals(list(merged.values()))})
    by_source.sort(key=lambda r: (r["ftds"], r["clicks"]), reverse=True)

    # Gasto de campanha não tem data por dia no modelo atual: é total acumulado.
    spend = await db.campaigns.aggregate([
        {"$match": {"workspace_id": ws_id}},
        {"$group": {"_id": None, "spend": {"$sum": {"$ifNull": ["$metrics.spend", 0]}}}},
    ]).to_list(1)

    prefs = (await db.users.find_one({"_id": ObjectId(user["_id"])}, {"analytics_kpis": 1}) or {}).get("analytics_kpis")
    return {
        "period": period, "granularity": granularity, "source": source,
        "range": {"start": start, "end": end, "previous_start": prev_start},
        "timezone": getattr(tz, "key", "UTC"),
        "currency": ws.get("currency", "BRL"),
        "kpis": kpis,
        "selected_kpis": prefs or DEFAULT_KPIS,
        "series": series,
        "funnel": funnel_steps(
            {t: current[k] for t, k in COUNT_KEYS.items()},
            {t: previous[k] for t, k in COUNT_KEYS.items()},
        ),
        "by_source": by_source,
        "spend_total": spend[0]["spend"] if spend else 0,
    }


@router.put("/analytics/preferences")
async def save_analytics_preferences(request: Request):
    user = await get_current_user(request)
    body = await request.json()
    kpis = body.get("kpis")
    if not isinstance(kpis, list) or not 1 <= len(kpis) <= 8 or any(k not in KPI_CATALOG for k in kpis):
        raise HTTPException(400, "Escolha de 1 a 8 KPIs do catálogo")
    await db.users.update_one({"_id": ObjectId(user["_id"])}, {"$set": {"analytics_kpis": kpis}})
    return {"selected_kpis": kpis}


# Compatibilidade: a tabela por origem que a tela antiga lia.
@router.get("/analytics")
async def get_analytics(request: Request, period: str = "30d"):
    data = await analytics_overview(request, period=period, granularity="day")
    return {"items": [{
        "source": r["source"], "clicks": r["clicks"], "registrations": r["registrations"],
        "ftds": r["ftds"], "deposits": r["deposits_value"], "value": r["deposits_value"],
    } for r in data["by_source"]], "period": period}


ATTENDANCE_SCAN_LIMIT = 5000


@router.get("/analytics/atendimento")
async def get_atendimento_analytics(request: Request, period: str = "30d"):
    user = await get_current_user(request)
    ws_id = user["workspace_id"]
    try:
        _, start, end = resolve_period(period)
    except ValueError as exc:
        raise HTTPException(400, str(exc))

    # ponytail: agrega em Python; acima de ATTENDANCE_SCAN_LIMIT conversas no
    # período, trocar por $group com $dateDiff no banco.
    convs = await db.conversations.find(
        {"workspace_id": ws_id, "created_at": {"$gte": start, "$lt": end}},
        {"assigned_to": 1, "assigned_name": 1, "status": 1, "created_at": 1,
         "first_response_at": 1, "close_reason": 1, "tags": 1},
    ).to_list(ATTENDANCE_SCAN_LIMIT)

    agents, reasons, tags = {}, {}, {}
    for c in convs:
        key = c.get("assigned_to") or "_unassigned"
        a = agents.setdefault(key, {
            "agent_id": c.get("assigned_to"), "name": c.get("assigned_name") or "Sem atendente",
            "conversations": 0, "resolved": 0, "pairs": [],
        })
        a["conversations"] += 1
        if c.get("status") == "resolved":
            a["resolved"] += 1
            reason = c.get("close_reason") or "unspecified"
            reasons[reason] = reasons.get(reason, 0) + 1
        a["pairs"].append((c.get("created_at"), c.get("first_response_at")))
        for tag in c.get("tags") or []:
            tags[tag] = tags.get(tag, 0) + 1

    by_agent = []
    for a in agents.values():
        stats = response_minutes(a.pop("pairs"))
        by_agent.append({**a, "first_response": stats, "resolution_rate": ratio(a["resolved"], a["conversations"], pct=True)})
    by_agent.sort(key=lambda a: a["conversations"], reverse=True)

    all_pairs = [(c.get("created_at"), c.get("first_response_at")) for c in convs]
    labels = {**CLOSE_REASONS, "unspecified": "Não informado"}
    return {
        "period": period,
        "queue": await db.conversations.count_documents({"workspace_id": ws_id, "status": "queue"}),
        "active": await db.conversations.count_documents({"workspace_id": ws_id, "status": "active"}),
        "total": len(convs),
        "truncated": len(convs) >= ATTENDANCE_SCAN_LIMIT,
        "first_response": response_minutes(all_pairs),
        "by_agent": by_agent,
        "close_reasons": sorted(
            [{"key": k, "label": labels.get(k, k), "count": v} for k, v in reasons.items()],
            key=lambda r: r["count"], reverse=True),
        "tags": sorted([{"tag": k, "count": v} for k, v in tags.items()], key=lambda r: r["count"], reverse=True)[:30],
    }
