from fastapi import APIRouter, HTTPException, Request, Query
from fastapi.responses import RedirectResponse, PlainTextResponse
from datetime import datetime, timezone
from bson import ObjectId
from domains_check import (
    PURPOSE_LABELS, SSL_LABELS, STATUS_LABELS as DOMAIN_STATUS, check_domain, expected_records, tracking_host,
)
from database import db, audit as _audit
from auth import get_current_user
from models import IntegrationCreate, IntegrationUpdate, DomainCreate, DomainUpdate, TrackingLinkCreate, TrackingLinkUpdate
from attribution import build_destination, device_from_ua, match_rule, normalize_source, pick_variant
from datetime import timedelta
from zoneinfo import ZoneInfo
import re
import uuid
from telegram_service import public_api_base, register_telegram_webhook
from messaging import notify
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
        query["name"] = {"$regex": re.escape(search), "$options": "i"}
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
    if not ObjectId.is_valid(integration_id):
        raise HTTPException(404, "Integração não encontrada")
    doc = await db.integrations.find_one({"_id": ObjectId(integration_id), "workspace_id": user["workspace_id"]})
    if not doc:
        raise HTTPException(404, "Integração não encontrada")
    doc["_id"] = str(doc["_id"])
    if doc.get("provider") in INBOUND_PROVIDERS and not (doc.get("config") or {}).get("postback_token"):
        token = secrets.token_urlsafe(24)
        config = {**(doc.get("config") or {}), "postback_token": token,
                  "postback_url": inbound_url(public_api_base(request), doc["provider"], doc["_id"], token)}
        await db.integrations.update_one({"_id": ObjectId(integration_id)}, {"$set": {"config": config}})
        doc["config"] = config
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
    if body.provider in INBOUND_PROVIDERS:
        config["postback_token"] = secrets.token_urlsafe(24)
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
    elif body.provider in INBOUND_PROVIDERS:
        config["postback_url"] = inbound_url(base_url, body.provider, doc["_id"], config["postback_token"])
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
    if not ObjectId.is_valid(integration_id):
        raise HTTPException(404, "Integração não encontrada")
    current = await db.integrations.find_one({"_id": ObjectId(integration_id), "workspace_id": user["workspace_id"]})
    if not current:
        raise HTTPException(404, "Integração não encontrada")
    update = {"updated_at": datetime.now(timezone.utc)}
    if body.name is not None:
        update["name"] = body.name
    if body.status is not None:
        update["status"] = body.status
    # Mescla em vez de substituir: a tela manda só o que o usuário editou, e
    # substituir apagava o webhook_secret do Telegram e o token de postback do
    # TAP — os webhooks passariam a recusar tudo. Campo vazio não apaga segredo.
    if body.credentials is not None:
        merged = dict(current.get("credentials") or {})
        merged.update({k: v for k, v in body.credentials.items() if v not in (None, "", "••••••")})
        update["credentials"] = merged
        if merged:
            update["status"] = "configured"
    if body.config is not None:
        update["config"] = {**(current.get("config") or {}), **body.config}
    await db.integrations.update_one({"_id": current["_id"]}, {"$set": update})
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
    if test_result["status"] != "success":
        await notify(
            user["workspace_id"], "integration_down",
            f"Integração {doc.get('name') or doc.get('provider')} com problema",
            "O teste de conexão falhou: credenciais ausentes.",
            link=f"/integrations/{integration_id}",
            dedupe_key=f"integration_down:{integration_id}",
        )
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


INBOUND_PROVIDERS = ("tap", "webhook_in", "postback")


def inbound_url(base_url, provider, integration_id, token):
    """URL que o parceiro chama: a do TAP continua na rota antiga."""
    path = "tap" if provider == "tap" else "in"
    return f"{base_url}/api/webhooks/{path}/{integration_id}?token={token}"


# ── Domains ──
def _domain_view(doc):
    doc["_id"] = str(doc["_id"])
    doc["status_label"] = DOMAIN_STATUS.get(doc.get("status"), doc.get("status"))
    doc["ssl_label"] = SSL_LABELS.get(doc.get("ssl_status"), doc.get("ssl_status"))
    doc["purpose_label"] = PURPOSE_LABELS.get(doc.get("purpose"), doc.get("purpose"))
    return doc



@router.get("/domains")
async def list_domains(request: Request, search: str = None, page: int = 1, limit: int = 50):
    user = await get_current_user(request)
    query = {"workspace_id": user["workspace_id"]}
    if search:
        query["domain"] = {"$regex": re.escape(search), "$options": "i"}
    total = await db.domains.count_documents(query)
    items = await db.domains.find(query).sort("created_at", -1).skip((page - 1) * limit).limit(limit).to_list(limit)
    return {"items": [_domain_view(item) for item in items], "total": total, "page": page,
            "pages": math.ceil(total / limit) if total else 1, "target_host": tracking_host()}


@router.get("/domains/{domain_id}")
async def get_domain(domain_id: str, request: Request):
    user = await get_current_user(request)
    if not ObjectId.is_valid(domain_id):
        raise HTTPException(404, "Domínio não encontrado")
    doc = await db.domains.find_one({"_id": ObjectId(domain_id), "workspace_id": user["workspace_id"]})
    if not doc:
        raise HTTPException(404, "Domínio não encontrado")
    doc["records"] = expected_records(doc["domain"], user["workspace_id"])
    doc["checks"] = await db.domain_checks.find({"domain_id": domain_id}).sort("checked_at", -1).limit(10).to_list(10)
    for check in doc["checks"]:
        check["_id"] = str(check["_id"])
    doc["links"] = await db.tracking_links.count_documents({"workspace_id": user["workspace_id"], "domain": doc["domain"]})
    return _domain_view(doc)


@router.post("/domains")
async def create_domain(body: DomainCreate, request: Request):
    user = await get_current_user(request)
    now = datetime.now(timezone.utc)
    existing = await db.domains.find_one({"domain": body.domain, "workspace_id": user["workspace_id"]})
    if existing:
        raise HTTPException(400, "Domínio já cadastrado")
    domain = body.domain.strip().lower().rstrip(".")
    if not re.fullmatch(r"[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+", domain):
        raise HTTPException(400, "Informe um domínio válido, como trk.seusite.com")
    doc = {
        "workspace_id": user["workspace_id"],
        "domain": domain,
        "purpose": body.purpose,
        "status": "pending_dns",
        "ssl_status": "pending",
        "dns_records": expected_records(domain, user["workspace_id"]),
        "clicks_30d": 0,
        "last_check": None,
        "created_at": now,
        "updated_at": now,
    }
    result = await db.domains.insert_one(doc)
    doc["_id"] = result.inserted_id
    return _domain_view(doc)


@router.post("/domains/{domain_id}/verify")
async def verify_domain(domain_id: str, request: Request):
    """Consulta o DNS de verdade e tenta o HTTPS no domínio do cliente."""
    user = await get_current_user(request)
    if not ObjectId.is_valid(domain_id):
        raise HTTPException(404, "Domínio não encontrado")
    doc = await db.domains.find_one({"_id": ObjectId(domain_id), "workspace_id": user["workspace_id"]})
    if not doc:
        raise HTTPException(404, "Domínio não encontrado")
    result = await check_domain(doc["domain"])
    await db.domains.update_one({"_id": doc["_id"]}, {"$set": {
        "status": result["status"], "ssl_status": result["ssl_status"],
        "last_check": result["checked_at"], "last_check_detail": result["detail"],
        "dns_records": expected_records(doc["domain"], user["workspace_id"]),
        "updated_at": result["checked_at"]}})
    await db.domain_checks.insert_one({"domain_id": domain_id, "workspace_id": user["workspace_id"], **result})
    return {**result, "status_label": DOMAIN_STATUS.get(result["status"], result["status"]),
            "ssl_label": SSL_LABELS.get(result["ssl_status"], result["ssl_status"])}


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
        pattern = {"$regex": re.escape(search), "$options": "i"}
        query["$or"] = [{"name": pattern}, {"slug": pattern}]
    if status:
        query["status"] = status
    total = await db.tracking_links.count_documents(query)
    items = await db.tracking_links.find(query).sort("created_at", -1).skip((page - 1) * limit).limit(limit).to_list(limit)
    for item in items:
        item["_id"] = str(item["_id"])
        item["public_url"] = _public_link(item["slug"], request)
    return {"items": items, "total": total, "page": page, "pages": math.ceil(total / limit) if total else 1}


# Parâmetros dinâmicos oficiais de cada plataforma. Kwai fica sem template:
# não publicamos macro que não conseguimos confirmar.
SOURCE_MACROS = {
    "meta": "utm_source=meta&utm_medium=paid&utm_campaign={{campaign.name}}&utm_content={{ad.name}}&utm_term={{adset.name}}",
    "tiktok": "utm_source=tiktok&utm_medium=paid&utm_campaign=__CAMPAIGN_NAME__&utm_content=__CID_NAME__&utm_term=__AID_NAME__",
    "google": "utm_source=google&utm_medium=paid&utm_campaign={campaignid}&utm_content={creative}&utm_term={keyword}",
}


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
    doc["public_url"] = _public_link(doc["slug"], request)
    return doc


@router.post("/tracking")
async def create_tracking_link(body: TrackingLinkCreate, request: Request):
    user = await get_current_user(request)
    now = datetime.now(timezone.utc)
    slug = body.slug.strip().lower()
    if not SLUG_RE.match(slug):
        raise HTTPException(400, "Slug aceita letras minúsculas, números e hífen (2 a 64)")
    # Único na plataforma inteira: a URL pública /api/r/{slug} não diz o workspace.
    if await db.tracking_links.find_one({"slug": slug}):
        raise HTTPException(400, "Slug já utilizado")
    _validate_link_routing(body.ab_variants, body.rules)
    doc = {
        "workspace_id": user["workspace_id"],
        "name": body.name,
        "slug": slug,
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
    doc["public_url"] = _public_link(slug, request)
    await _audit(user, "tracking.create", doc["_id"], "tracking_link")
    return doc


SLUG_RE = re.compile(r"^[a-z0-9][a-z0-9-]{1,63}$")
RULE_TYPES = {"device", "country", "hour"}


def _validate_link_routing(variants, rules):
    for v in variants or []:
        if not str(v.get("destination") or "").startswith(("http://", "https://")):
            raise HTTPException(400, "Toda variante precisa de destino http(s)")
        try:
            if float(v.get("weight", 0)) < 0:
                raise ValueError
        except (TypeError, ValueError):
            raise HTTPException(400, "Peso da variante deve ser um número >= 0")
    for r in rules or []:
        if r.get("type") not in RULE_TYPES:
            raise HTTPException(400, "Regra deve ser do tipo device, country ou hour")
        if not r.get("values"):
            raise HTTPException(400, "Regra sem valores")
        if not str(r.get("destination") or "").startswith(("http://", "https://")):
            raise HTTPException(400, "Toda regra precisa de destino http(s)")


@router.put("/tracking/{link_id}")
async def update_tracking_link(link_id: str, body: TrackingLinkUpdate, request: Request):
    user = await get_current_user(request)
    if not ObjectId.is_valid(link_id):
        raise HTTPException(404, "Link não encontrado")
    update = {k: v for k, v in body.model_dump(exclude_unset=True).items()}
    if "status" in update and update["status"] not in ("active", "paused"):
        raise HTTPException(400, "Status deve ser active ou paused")
    if "destination" in update and not str(update["destination"]).startswith(("http://", "https://")):
        raise HTTPException(400, "Destino precisa ser http(s)")
    _validate_link_routing(update.get("ab_variants"), update.get("rules"))
    update["updated_at"] = datetime.now(timezone.utc)
    result = await db.tracking_links.update_one(
        {"_id": ObjectId(link_id), "workspace_id": user["workspace_id"]}, {"$set": update})
    if result.matched_count == 0:
        raise HTTPException(404, "Link não encontrado")
    await _audit(user, "tracking.update", link_id, "tracking_link")
    doc = await db.tracking_links.find_one({"_id": ObjectId(link_id)})
    doc["_id"] = str(doc["_id"])
    doc["public_url"] = _public_link(doc["slug"], request)
    return doc


@router.get("/tracking/{link_id}/stats")
async def tracking_link_stats(link_id: str, request: Request, days: int = 30):
    user = await get_current_user(request)
    ws_id = user["workspace_id"]
    if not ObjectId.is_valid(link_id):
        raise HTTPException(404, "Link não encontrado")
    link = await db.tracking_links.find_one({"_id": ObjectId(link_id), "workspace_id": ws_id})
    if not link:
        raise HTTPException(404, "Link não encontrado")
    days = max(1, min(days, 180))
    since = datetime.now(timezone.utc) - timedelta(days=days)
    match = {"workspace_id": ws_id, "type": "click", "metadata.link_id": link_id, "created_at": {"$gte": since}}

    async def group(field):
        rows = await db.events.aggregate([
            {"$match": match},
            {"$group": {"_id": f"${field}", "clicks": {"$sum": 1}}},
            {"$sort": {"clicks": -1}},
        ]).to_list(50)
        return [{"key": r["_id"] or "—", "clicks": r["clicks"]} for r in rows]

    by_day = await db.events.aggregate([
        {"$match": match},
        {"$group": {"_id": {"$dateToString": {"format": "%Y-%m-%d", "date": "$created_at"}}, "clicks": {"$sum": 1}}},
        {"$sort": {"_id": 1}},
    ]).to_list(200)
    recent = await db.events.find(match, {"external_id": 1, "metadata": 1, "person_id": 1, "status": 1, "created_at": 1}) \
        .sort("created_at", -1).limit(50).to_list(50)
    for r in recent:
        r["_id"] = str(r["_id"])
    click_ids = [r["external_id"] for r in recent] if recent else []
    ftds = await db.events.count_documents({
        "workspace_id": ws_id, "type": "ftd", "attribution.link_id": link_id, "created_at": {"$gte": since},
    })
    history = await db.audit_log.find({"workspace_id": ws_id, "object_id": link_id}).sort("timestamp", -1).limit(30).to_list(30)
    for h in history:
        h["_id"] = str(h["_id"])
    return {
        "days": days,
        "clicks": sum(d["clicks"] for d in by_day),
        "ftds": ftds,
        "by_day": [{"date": d["_id"], "clicks": d["clicks"]} for d in by_day],
        "by_variant": await group("metadata.variant"),
        "by_device": await group("metadata.device"),
        "by_country": await group("metadata.country"),
        "recent": recent,
        "sample_click_ids": click_ids[:5],
        "history": history,
    }


def _public_link(slug, request):
    try:
        return f"{public_api_base(request)}/api/r/{slug}"
    except ValueError:
        return None


@router.get("/tracking/{link_id}/qr.svg")
async def tracking_link_qr(link_id: str, request: Request):
    import io as _io
    import segno
    from fastapi.responses import Response
    user = await get_current_user(request)
    if not ObjectId.is_valid(link_id):
        raise HTTPException(404, "Link não encontrado")
    link = await db.tracking_links.find_one({"_id": ObjectId(link_id), "workspace_id": user["workspace_id"]})
    if not link:
        raise HTTPException(404, "Link não encontrado")
    url = _public_link(link["slug"], request)
    if not url:
        raise HTTPException(500, "URL pública da plataforma não configurada")
    buf = _io.BytesIO()
    segno.make(url, error="m").save(buf, kind="svg", scale=6, border=2, dark="#000000", light="#ffffff", xmldecl=False)
    return Response(buf.getvalue(), media_type="image/svg+xml",
                    headers={"Content-Disposition": f'inline; filename="{link["slug"]}.svg"'})


@router.delete("/tracking/{link_id}")
async def delete_tracking_link(link_id: str, request: Request):
    user = await get_current_user(request)
    result = await db.tracking_links.delete_one({"_id": ObjectId(link_id), "workspace_id": user["workspace_id"]})
    if result.deleted_count == 0:
        raise HTTPException(404, "Link não encontrado")
    return {"detail": "Removido"}




# ── Redirect público ──
def _local_hour(tz_name):
    try:
        return datetime.now(ZoneInfo(tz_name or "America/Sao_Paulo")).hour
    except Exception:  # noqa: BLE001 — fuso inválido não derruba o redirect
        return datetime.now(timezone.utc).hour


@router.get("/r/{slug}")
async def follow_tracking_link(slug: str, request: Request):
    """Registra o clique no ledger e redireciona levando o click_id adiante."""
    link = await db.tracking_links.find_one({"slug": slug.lower()})
    if not link or link.get("status") != "active":
        return PlainTextResponse("Link indisponível.", status_code=404)

    ws_id = link["workspace_id"]
    ws = await db.workspaces.find_one({"_id": ObjectId(ws_id)}, {"timezone": 1}) if ObjectId.is_valid(ws_id) else None
    ctx = {
        "device": device_from_ua(request.headers.get("user-agent")),
        # Só existe com Cloudflare (ou outro proxy de borda) na frente do domínio.
        "country": (request.headers.get("cf-ipcountry") or "").upper() or None,
        "hour": _local_hour((ws or {}).get("timezone")),
    }

    destination, variant, rule = link["destination"], None, None
    matched = match_rule(link.get("rules") or [], ctx)
    if matched:
        destination, rule = matched["destination"], matched.get("type")
    else:
        chosen = pick_variant(link.get("ab_variants") or [])
        if chosen:
            destination, variant = chosen["destination"], chosen.get("name") or chosen["destination"]

    click_id = uuid.uuid4().hex[:20]
    now = datetime.now(timezone.utc)
    await db.events.insert_one({
        "workspace_id": ws_id,
        "type": "click",
        "person_id": None,
        "source": (link.get("utm_source") or "").strip().lower() or None,
        "value": None,
        "currency": None,
        "external_id": click_id,
        "metadata": {
            "link_id": str(link["_id"]),
            "link_name": link.get("name"),
            "slug": link["slug"],
            "campaign_id": link.get("campaign_id"),
            "utm_medium": link.get("utm_medium"),
            "utm_campaign": link.get("utm_campaign"),
            "utm_content": link.get("utm_content"),
            "utm_term": link.get("utm_term"),
            "variant": variant,
            "rule": rule,
            "device": ctx["device"],
            "country": ctx["country"],
            "referer": (request.headers.get("referer") or "")[:300] or None,
            # Parâmetros que a plataforma de mídia anexou (fbclid, ttclid, gclid…).
            "query": dict(request.query_params),
        },
        "status": "captured",
        "attribution": None,
        "fact_at": now,
        "received_at": now,
        "created_at": now,
    })
    await db.tracking_links.update_one({"_id": link["_id"]}, {"$inc": {"clicks": 1}, "$set": {"last_click_at": now}})
    return RedirectResponse(build_destination(destination, click_id), status_code=302)
