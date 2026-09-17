"""Administração da plataforma: planos, uso, faturas, IA, confiabilidade e suporte."""
from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import Response
from datetime import datetime, timedelta, timezone
from bson import ObjectId
from database import db, audit
from auth import get_current_user, require_admin
from messaging import notify
from admin_logic import (
    AI_TASKS, DSR_STATUS, DSR_TYPES, INCIDENT_IMPACT, INCIDENT_STATUS, INVOICE_STATUS, METERS, MODEL_PRICES,
    TICKET_STATUS, dsr_deadline, estimate_cost, estimate_tokens, incident_duration, invoice_lines,
    month_range, next_version, plan_changes, slo_state, uptime, usage_status,
)
import json

router = APIRouter(prefix="/api/admin", tags=["admin"])
public_router = APIRouter(prefix="/api", tags=["status"])

DEFAULT_ROUTING = {task: {"provider": "anthropic", "model": "claude-haiku-4-5-20251001"} for task in AI_TASKS}
DEFAULT_GUARDRAILS = {"monthly_token_cap": 2_000_000, "max_reply_words": 220,
                      "blocked_terms": ["garantia de lucro", "aposta certa"], "require_human_for_payment": True}
DEFAULT_SLOS = [
    {"key": "api_uptime", "name": "API disponível", "target": 99.5, "unit": "%"},
    {"key": "webhook_success", "name": "Webhooks recebidos sem erro", "target": 99.0, "unit": "%"},
]


async def _body(request: Request) -> dict:
    try:
        data = await request.json()
    except Exception:  # noqa: BLE001
        return {}
    return data if isinstance(data, dict) else {}


def _oid(value, what):
    if not ObjectId.is_valid(str(value)):
        raise HTTPException(404, f"{what} não encontrado")
    return ObjectId(str(value))


async def _setting(key: str, default):
    doc = await db.platform_settings.find_one({"key": key})
    return (doc or {}).get("value", default)


async def _save_setting(key: str, value):
    await db.platform_settings.update_one({"key": key}, {"$set": {"value": value, "updated_at": datetime.now(timezone.utc)}}, upsert=True)
    return value


# ── Planos versionados ──
@router.get("/plans")
async def list_plans(request: Request):
    await require_admin(request)
    plans = await db.plans.find({}).sort("created_at", -1).to_list(100)
    for plan in plans:
        plan["_id"] = str(plan["_id"])
        plan["tenants"] = await db.workspaces.count_documents({"plan": plan["name"]})
    return {"items": plans, "meters": METERS}


@router.post("/plans")
async def create_plan(request: Request):
    user = await require_admin(request)
    body = await _body(request)
    name = (body.get("name") or "").strip()
    if not name:
        raise HTTPException(400, "Dê um nome ao plano")
    if await db.plans.find_one({"name": name}):
        raise HTTPException(400, "Já existe um plano com esse nome")
    now = datetime.now(timezone.utc)
    doc = {"name": name, "price": float(body.get("price") or 0), "currency": body.get("currency", "BRL"),
           "features": body.get("features") or [], "limits": body.get("limits") or {},
           "overage": body.get("overage") or {}, "version": 1, "status": "active",
           "created_at": now, "updated_at": now}
    doc["_id"] = str((await db.plans.insert_one(doc)).inserted_id)
    await db.plan_versions.insert_one({**doc, "plan_id": doc["_id"], "_id": ObjectId(), "changes": ["criado"], "by": user.get("email"), "at": now})
    await audit(user, "plan.create", doc["_id"], "plan")
    return doc


@router.put("/plans/{plan_id}")
async def update_plan(plan_id: str, request: Request):
    """Cada alteração vira uma versão nova: o que já foi cobrado não muda."""
    user = await require_admin(request)
    plan = await db.plans.find_one({"_id": _oid(plan_id, "Plano")})
    if not plan:
        raise HTTPException(404, "Plano não encontrado")
    body = await _body(request)
    updated = {**plan, **{k: body[k] for k in ("price", "currency", "features", "limits", "overage", "status") if k in body}}
    changes = plan_changes(plan, updated)
    if not changes:
        return {"detail": "Nada mudou", "version": plan.get("version")}
    versions = await db.plan_versions.find({"plan_id": plan_id}).to_list(200)
    version = next_version(versions or [plan])
    now = datetime.now(timezone.utc)
    await db.plans.update_one({"_id": plan["_id"]}, {"$set": {
        **{k: updated[k] for k in ("price", "currency", "features", "limits", "overage", "status")},
        "version": version, "updated_at": now}})
    await db.plan_versions.insert_one({"plan_id": plan_id, "name": plan["name"], "version": version,
                                       "price": updated.get("price"), "limits": updated.get("limits"),
                                       "features": updated.get("features"), "changes": changes,
                                       "by": user.get("email"), "at": now})
    await audit(user, "plan.version", plan_id, "plan")
    return {"version": version, "changes": changes}


@router.get("/plans/{plan_id}/versions")
async def plan_versions(plan_id: str, request: Request):
    await require_admin(request)
    items = await db.plan_versions.find({"plan_id": plan_id}).sort("version", -1).to_list(100)
    for item in items:
        item["_id"] = str(item["_id"])
    return {"items": items}


# ── Medição de uso ──
async def _usage_for(ws_id: str, start: datetime, end: datetime, limits: dict):
    counts = {
        "events": await db.events.count_documents({"workspace_id": ws_id, "created_at": {"$gte": start, "$lt": end}}),
        "messages": await db.messages.count_documents({"workspace_id": ws_id, "created_at": {"$gte": start, "$lt": end}}),
        "dispatches": await db.dispatch_recipients.count_documents({"workspace_id": ws_id, "status": "sent", "sent_at": {"$gte": start, "$lt": end}}),
        "ai_replies": await db.ai_agent_runs.count_documents({"workspace_id": ws_id, "created_at": {"$gte": start, "$lt": end}}),
        "users": await db.users.count_documents({"workspace_id": ws_id}),
    }
    return {meter: usage_status(value, (limits or {}).get(meter)) for meter, value in counts.items()}


@router.get("/usage")
async def usage(request: Request, month: str = None):
    await require_admin(request)
    start, end, label = month_range(month)
    plans = {plan["name"]: plan async for plan in db.plans.find({})}
    rows = []
    async for ws in db.workspaces.find({}, {"name": 1, "plan": 1}):
        plan = plans.get(ws.get("plan")) or {}
        rows.append({"workspace_id": str(ws["_id"]), "name": ws.get("name"), "plan": ws.get("plan") or "—",
                     "usage": await _usage_for(str(ws["_id"]), start, end, plan.get("limits"))})
    return {"month": label, "meters": METERS, "items": rows}


# ── Faturas ──
@router.get("/invoices")
async def list_invoices(request: Request, month: str = None, workspace_id: str = None):
    await require_admin(request)
    query = {}
    if month:
        query["month"] = month
    if workspace_id:
        query["workspace_id"] = workspace_id
    items = await db.tenant_invoices.find(query).sort("created_at", -1).limit(200).to_list(200)
    for item in items:
        item["_id"] = str(item["_id"])
    return {"items": items, "status_labels": INVOICE_STATUS}


@router.post("/invoices/generate")
async def generate_invoices(request: Request):
    """Fecha o mês: assinatura + excedente de cada tenant, sem duplicar fatura."""
    user = await require_admin(request)
    body = await _body(request)
    start, end, label = month_range(body.get("month"))
    plans = {plan["name"]: plan async for plan in db.plans.find({})}
    created, skipped = [], 0
    async for ws in db.workspaces.find({}, {"name": 1, "plan": 1}):
        ws_id = str(ws["_id"])
        if await db.tenant_invoices.find_one({"workspace_id": ws_id, "month": label}):
            skipped += 1
            continue
        plan = plans.get(ws.get("plan")) or {"name": ws.get("plan") or "sem plano", "price": 0}
        usage_data = await _usage_for(ws_id, start, end, plan.get("limits"))
        invoice = invoice_lines(plan, usage_data)
        now = datetime.now(timezone.utc)
        doc = {"workspace_id": ws_id, "workspace_name": ws.get("name"), "month": label,
               "plan": plan.get("name"), "plan_version": plan.get("version", 1),
               "status": "open", "due_at": end + timedelta(days=5), "created_at": now,
               "usage": {meter: data["used"] for meter, data in usage_data.items()}, **invoice}
        doc["_id"] = str((await db.tenant_invoices.insert_one(doc)).inserted_id)
        created.append(doc)
    await audit(user, "invoice.generate", label, "invoice")
    return {"month": label, "created": len(created), "skipped": skipped, "items": created}


@router.put("/invoices/{invoice_id}")
async def update_invoice(invoice_id: str, request: Request):
    user = await require_admin(request)
    body = await _body(request)
    status = body.get("status")
    if status not in INVOICE_STATUS:
        raise HTTPException(400, "Status de fatura inválido")
    result = await db.tenant_invoices.update_one({"_id": _oid(invoice_id, "Fatura")}, {"$set": {
        "status": status, "paid_at": datetime.now(timezone.utc) if status == "paid" else None}})
    if not result.matched_count:
        raise HTTPException(404, "Fatura não encontrada")
    await audit(user, f"invoice.{status}", invoice_id, "invoice")
    return {"status": status}


@router.get("/invoices/{invoice_id}/export.csv")
async def export_invoice(invoice_id: str, request: Request):
    await require_admin(request)
    invoice = await db.tenant_invoices.find_one({"_id": _oid(invoice_id, "Fatura")})
    if not invoice:
        raise HTTPException(404, "Fatura não encontrada")
    lines = ["Descrição;Quantidade;Valor unitário;Total"]
    for line in invoice["lines"]:
        lines.append(f"{line['description']};{line['quantity']};{line['unit_price']};{line['total']}")
    lines.append(f"Total;;;{invoice['total']}")
    return Response("﻿" + "\r\n".join(lines), media_type="text/csv; charset=utf-8",
                    headers={"Content-Disposition": f"attachment; filename=\"fatura_{invoice['month']}.csv\""})


# ── IA: roteamento, prompts, custo e guardrails ──
@router.get("/ai")
async def ai_settings(request: Request):
    await require_admin(request)
    start, end, label = month_range(None)
    runs = await db.ai_agent_runs.find({"created_at": {"$gte": start, "$lt": end}}, {"incoming": 1, "reply": 1, "workspace_id": 1}).to_list(5000)
    by_workspace = {}
    total_tokens = 0
    routing = await _setting("ai_routing", DEFAULT_ROUTING)
    model = (routing.get("agent") or {}).get("model", "claude-haiku-4-5-20251001")
    for run in runs:
        tokens = estimate_tokens(run.get("incoming", "")) + estimate_tokens(run.get("reply", ""))
        total_tokens += tokens
        entry = by_workspace.setdefault(run.get("workspace_id"), {"calls": 0, "tokens": 0})
        entry["calls"] += 1
        entry["tokens"] += tokens
    names = {str(ws["_id"]): ws.get("name") async for ws in db.workspaces.find({}, {"name": 1})}
    guardrails = await _setting("ai_guardrails", DEFAULT_GUARDRAILS)
    return {
        "routing": routing, "tasks": AI_TASKS, "models": MODEL_PRICES, "guardrails": guardrails,
        "month": label, "total_tokens": total_tokens, "total_cost": estimate_cost(model, total_tokens),
        "cap_state": usage_status(total_tokens, guardrails.get("monthly_token_cap")),
        "by_workspace": [{"workspace_id": ws, "name": names.get(ws, "—"), **data,
                          "cost": estimate_cost(model, data["tokens"])} for ws, data in by_workspace.items()],
        "prompts": [{**p, "_id": str(p["_id"])} for p in await db.platform_prompts.find({}).sort("created_at", -1).to_list(100)],
    }


@router.put("/ai/routing")
async def set_routing(request: Request):
    user = await require_admin(request)
    body = await _body(request)
    routing = {}
    for task in AI_TASKS:
        entry = (body.get(task) or {})
        model = entry.get("model")
        if model not in MODEL_PRICES:
            raise HTTPException(400, f"Modelo inválido para {AI_TASKS[task]}")
        routing[task] = {"provider": entry.get("provider") or "anthropic", "model": model}
    await audit(user, "ai.routing", None, "platform")
    return await _save_setting("ai_routing", routing)


@router.put("/ai/guardrails")
async def set_guardrails(request: Request):
    user = await require_admin(request)
    body = await _body(request)
    try:
        guardrails = {
            "monthly_token_cap": max(0, int(body.get("monthly_token_cap") or 0)),
            "max_reply_words": max(20, min(1000, int(body.get("max_reply_words") or 220))),
            "blocked_terms": [t.strip() for t in body.get("blocked_terms") or [] if str(t).strip()],
            "require_human_for_payment": bool(body.get("require_human_for_payment")),
        }
    except (TypeError, ValueError):
        raise HTTPException(400, "Limite de tokens e de palavras precisam ser números")
    await audit(user, "ai.guardrails", None, "platform")
    return await _save_setting("ai_guardrails", guardrails)


@router.post("/ai/prompts")
async def create_prompt(request: Request):
    user = await require_admin(request)
    body = await _body(request)
    name, content = (body.get("name") or "").strip(), (body.get("content") or "").strip()
    if not name or not content:
        raise HTTPException(400, "Informe nome e conteúdo do prompt")
    doc = {"name": name, "task": body.get("task") if body.get("task") in AI_TASKS else "agent",
           "content": content, "created_by": user.get("email"), "created_at": datetime.now(timezone.utc)}
    doc["_id"] = str((await db.platform_prompts.insert_one(doc)).inserted_id)
    return doc


@router.delete("/ai/prompts/{prompt_id}")
async def delete_prompt(prompt_id: str, request: Request):
    await require_admin(request)
    result = await db.platform_prompts.delete_one({"_id": _oid(prompt_id, "Prompt")})
    if not result.deleted_count:
        raise HTTPException(404, "Prompt não encontrado")
    return {"detail": "Removido"}


# ── Confiabilidade: SLO, incidentes, releases ──
@router.get("/reliability")
async def reliability(request: Request, days: int = 30):
    await require_admin(request)
    since = datetime.now(timezone.utc) - timedelta(days=max(1, min(days, 90)))
    beats = await db.health_beats.find({"at": {"$gte": since}}).to_list(20000)
    api_uptime = uptime(beats)
    webhook_total = await db.events.count_documents({"created_at": {"$gte": since}})
    webhook_fail = await db.webhook_failures.count_documents({"created_at": {"$gte": since}})
    webhook_rate = round((webhook_total - webhook_fail) / webhook_total * 100, 3) if webhook_total else None
    measured = {"api_uptime": api_uptime["uptime"], "webhook_success": webhook_rate}
    slos = await _setting("slos", DEFAULT_SLOS)
    incidents = await db.incidents.find({}).sort("started_at", -1).limit(50).to_list(50)
    for incident in incidents:
        incident["_id"] = str(incident["_id"])
        incident["duration_min"] = incident_duration(incident)
    releases = await db.releases.find({}).sort("released_at", -1).limit(50).to_list(50)
    for release in releases:
        release["_id"] = str(release["_id"])
    return {
        "slos": [{**slo, "measured": measured.get(slo["key"]), "state": slo_state(measured.get(slo["key"]), slo["target"])} for slo in slos],
        "samples": api_uptime, "incidents": incidents, "releases": releases,
        "status_labels": INCIDENT_STATUS, "impact_labels": INCIDENT_IMPACT, "days": days,
    }


@router.post("/incidents")
async def create_incident(request: Request):
    user = await require_admin(request)
    body = await _body(request)
    title = (body.get("title") or "").strip()
    if not title:
        raise HTTPException(400, "Dê um título ao incidente")
    if body.get("impact") not in INCIDENT_IMPACT:
        raise HTTPException(400, "Informe o impacto do incidente")
    now = datetime.now(timezone.utc)
    doc = {"title": title, "impact": body["impact"], "status": "investigating",
           "started_at": now, "resolved_at": None, "created_by": user.get("email"),
           "updates": [{"at": now, "status": "investigating", "text": (body.get("detail") or "Estamos apurando.").strip()}]}
    doc["_id"] = str((await db.incidents.insert_one(doc)).inserted_id)
    await audit(user, "incident.open", doc["_id"], "incident")
    return doc


@router.post("/incidents/{incident_id}/update")
async def update_incident(incident_id: str, request: Request):
    user = await require_admin(request)
    body = await _body(request)
    status = body.get("status")
    if status not in INCIDENT_STATUS:
        raise HTTPException(400, "Status inválido")
    now = datetime.now(timezone.utc)
    update = {"status": status, "updated_at": now}
    if status == "resolved":
        update["resolved_at"] = now
    result = await db.incidents.update_one({"_id": _oid(incident_id, "Incidente")}, {
        "$set": update,
        "$push": {"updates": {"at": now, "status": status, "text": (body.get("text") or "").strip() or INCIDENT_STATUS[status]}}})
    if not result.matched_count:
        raise HTTPException(404, "Incidente não encontrado")
    await audit(user, f"incident.{status}", incident_id, "incident")
    return {"status": status}


@router.post("/releases")
async def create_release(request: Request):
    user = await require_admin(request)
    body = await _body(request)
    version = (body.get("version") or "").strip()
    if not version:
        raise HTTPException(400, "Informe a versão")
    doc = {"version": version, "title": (body.get("title") or "").strip() or version,
           "notes": (body.get("notes") or "").strip(), "released_at": datetime.now(timezone.utc),
           "released_by": user.get("email")}
    doc["_id"] = str((await db.releases.insert_one(doc)).inserted_id)
    return doc


# ── Suporte, comunicados, DSR e equipe ──
@router.get("/support")
async def support(request: Request):
    await require_admin(request)
    tickets = await db.support_tickets.find({}).sort("created_at", -1).limit(100).to_list(100)
    for ticket in tickets:
        ticket["_id"] = str(ticket["_id"])
    announcements = await db.announcements.find({}).sort("created_at", -1).limit(50).to_list(50)
    for item in announcements:
        item["_id"] = str(item["_id"])
    requests_ = await db.dsr_requests.find({}).sort("created_at", -1).limit(100).to_list(100)
    for item in requests_:
        item["_id"] = str(item["_id"])
        item["deadline"] = dsr_deadline(item["created_at"])
    team = await db.users.find({"role": "admin"}, {"name": 1, "email": 1, "workspace_id": 1, "created_at": 1}).to_list(100)
    for member in team:
        member["_id"] = str(member["_id"])
    return {"tickets": tickets, "announcements": announcements, "dsr": requests_, "team": team,
            "ticket_status": TICKET_STATUS, "dsr_types": DSR_TYPES, "dsr_status": DSR_STATUS}


@router.post("/support/tickets")
async def create_ticket(request: Request):
    user = await get_current_user(request)
    body = await _body(request)
    subject = (body.get("subject") or "").strip()
    message = (body.get("message") or "").strip()
    if not subject or not message:
        raise HTTPException(400, "Informe assunto e mensagem")
    now = datetime.now(timezone.utc)
    doc = {"workspace_id": user.get("workspace_id"), "subject": subject, "status": "open",
           "opened_by": user.get("email"), "created_at": now,
           "messages": [{"at": now, "by": user.get("email"), "text": message}]}
    doc["_id"] = str((await db.support_tickets.insert_one(doc)).inserted_id)
    return doc


@router.post("/support/tickets/{ticket_id}/reply")
async def reply_ticket(ticket_id: str, request: Request):
    user = await require_admin(request)
    body = await _body(request)
    text = (body.get("text") or "").strip()
    if not text:
        raise HTTPException(400, "Escreva a resposta")
    now = datetime.now(timezone.utc)
    ticket = await db.support_tickets.find_one({"_id": _oid(ticket_id, "Chamado")})
    if not ticket:
        raise HTTPException(404, "Chamado não encontrado")
    status = body.get("status") if body.get("status") in TICKET_STATUS else "answered"
    await db.support_tickets.update_one({"_id": ticket["_id"]}, {
        "$set": {"status": status, "updated_at": now},
        "$push": {"messages": {"at": now, "by": user.get("email"), "text": text, "staff": True}}})
    if ticket.get("workspace_id"):
        await notify(ticket["workspace_id"], "support_reply", f"Resposta do suporte: {ticket['subject']}", text[:180])
    return {"status": status}


@router.post("/announcements")
async def create_announcement(request: Request):
    """Comunicado vira notificação em todos os workspaces (ou nos escolhidos)."""
    user = await require_admin(request)
    body = await _body(request)
    title = (body.get("title") or "").strip()
    text = (body.get("text") or "").strip()
    if not title or not text:
        raise HTTPException(400, "Informe título e texto do comunicado")
    targets = body.get("workspace_ids") or [str(ws["_id"]) async for ws in db.workspaces.find({}, {"_id": 1})]
    now = datetime.now(timezone.utc)
    doc = {"title": title, "text": text, "workspaces": len(targets), "created_by": user.get("email"), "created_at": now}
    doc["_id"] = str((await db.announcements.insert_one(doc)).inserted_id)
    for ws_id in targets:
        await notify(ws_id, "announcement", title, text[:280], dedupe_key=f"announcement:{doc['_id']}")
    await audit(user, "announcement.send", doc["_id"], "announcement")
    return doc


@router.post("/dsr")
async def create_dsr(request: Request):
    user = await require_admin(request)
    body = await _body(request)
    if body.get("type") not in DSR_TYPES:
        raise HTTPException(400, "Tipo de pedido inválido")
    subject = (body.get("subject") or "").strip()
    if not subject:
        raise HTTPException(400, "Informe o e-mail, telefone ou id do titular")
    doc = {"type": body["type"], "subject": subject, "workspace_id": body.get("workspace_id"),
           "status": "open", "note": (body.get("note") or "").strip() or None,
           "created_by": user.get("email"), "created_at": datetime.now(timezone.utc)}
    doc["_id"] = str((await db.dsr_requests.insert_one(doc)).inserted_id)
    await audit(user, "dsr.open", doc["_id"], "dsr")
    return doc


async def _find_subject(subject: str, workspace_id=None):
    query = {"$or": [
        {"contact.email": subject}, {"contact.phone": subject}, {"external_ids.telegram_username": subject.lstrip("@")},
        {"external_ids.telegram_user_id": subject}, {"external_ids.whatsapp_user_id": subject},
    ]}
    if workspace_id:
        query["workspace_id"] = workspace_id
    return await db.players.find(query).to_list(50)


@router.post("/dsr/{request_id}/run")
async def run_dsr(request_id: str, request: Request):
    """Executa o pedido do titular: exporta os dados ou apaga tudo que identifica."""
    user = await require_admin(request)
    doc = await db.dsr_requests.find_one({"_id": _oid(request_id, "Pedido")})
    if not doc:
        raise HTTPException(404, "Pedido não encontrado")
    if doc["status"] != "open":
        raise HTTPException(400, "Pedido já foi tratado")
    players = await _find_subject(doc["subject"], doc.get("workspace_id"))
    now = datetime.now(timezone.utc)
    if doc["type"] == "export":
        payload = []
        for player in players:
            pid = str(player["_id"])
            payload.append({
                "lead": {**{k: v for k, v in player.items() if k != "_id"}, "id": pid},
                "eventos": [{k: v for k, v in e.items() if k != "_id"} async for e in db.events.find({"player_id": pid}).limit(500)],
                "conversas": [{k: v for k, v in c.items() if k != "_id"} async for c in db.conversations.find({"player_id": pid}).limit(100)],
            })
        await db.dsr_requests.update_one({"_id": doc["_id"]}, {"$set": {
            "status": "done", "done_at": now, "records": len(players), "result": "exportado"}})
        await audit(user, "dsr.export", request_id, "dsr")
        return Response(json.dumps({"titular": doc["subject"], "gerado_em": now.isoformat(), "dados": payload},
                                   default=str, ensure_ascii=False, indent=2),
                        media_type="application/json; charset=utf-8",
                        headers={"Content-Disposition": f'attachment; filename="dsr_{request_id}.json"'})
    removed = 0
    for player in players:
        pid = str(player["_id"])
        await db.players.update_one({"_id": player["_id"]}, {"$set": {
            "name": "Titular removido", "contact": {}, "external_ids": {}, "anonymized_at": now}})
        await db.messages.update_many({"workspace_id": player["workspace_id"], "sender_name": player.get("name")},
                                      {"$set": {"sender_name": "Titular removido"}})
        await db.lead_memories.delete_many({"player_id": pid})
        removed += 1
    await db.dsr_requests.update_one({"_id": doc["_id"]}, {"$set": {
        "status": "done", "done_at": now, "records": removed, "result": "dados anonimizados"}})
    await audit(user, "dsr.delete", request_id, "dsr")
    return {"status": "done", "records": removed, "result": "dados anonimizados"}


@router.put("/team/{user_id}")
async def set_role(user_id: str, request: Request):
    """Promove ou tira alguém da equipe global da plataforma."""
    user = await require_admin(request)
    body = await _body(request)
    role = body.get("role")
    if role not in ("admin", "member"):
        raise HTTPException(400, "Papel deve ser admin ou member")
    if str(user["_id"]) == user_id and role != "admin":
        raise HTTPException(400, "Você não pode remover o seu próprio acesso")
    result = await db.users.update_one({"_id": _oid(user_id, "Usuário")}, {"$set": {"role": role}})
    if not result.matched_count:
        raise HTTPException(404, "Usuário não encontrado")
    await audit(user, f"team.{role}", user_id, "user")
    return {"role": role}


# ── Status público ──
@public_router.get("/status")
async def status_page():
    """Página de status: sem login, só o essencial."""
    since = datetime.now(timezone.utc) - timedelta(days=30)
    beats = await db.health_beats.find({"at": {"$gte": since}}).to_list(20000)
    incidents = await db.incidents.find({"resolved_at": None}).sort("started_at", -1).to_list(10)
    recent = await db.incidents.find({"resolved_at": {"$ne": None}}).sort("started_at", -1).limit(5).to_list(5)
    for item in incidents + recent:
        item["_id"] = str(item["_id"])
        item.pop("created_by", None)
    state = "Tudo funcionando" if not incidents else INCIDENT_IMPACT.get(incidents[0].get("impact"), "Instável")
    return {"state": state, "uptime_30d": uptime(beats), "open_incidents": incidents, "recent_incidents": recent}
