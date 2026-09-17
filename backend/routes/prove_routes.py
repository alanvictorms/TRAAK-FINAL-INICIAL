from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import Response
from datetime import datetime, timezone
from bson import ObjectId
from database import db, audit
from auth import get_current_user
from models import ReportCreate, ApprovalCreate
from messaging import notify
from analytics import resolve_period, workspace_tz
from attribution import normalize_source
from prove_logic import (
    FREQUENCIES, KILL_SWITCHES, POLICY_TYPES, REPORT_DIMENSIONS, REPORT_METRICS, REPORT_PERIODS,
    csv_escape, next_run, periods_overlap, policy_errors, reconcile, row_metrics,
)
import math

router = APIRouter(prefix="/api", tags=["prove"])


async def _body(request: Request) -> dict:
    try:
        data = await request.json()
    except Exception:  # noqa: BLE001
        return {}
    return data if isinstance(data, dict) else {}


def _oid_or_404(value, what):
    if not ObjectId.is_valid(str(value)):
        raise HTTPException(404, f"{what} não encontrado")
    return ObjectId(str(value))


async def _workspace(ws_id):
    return await db.workspaces.find_one({"_id": ObjectId(ws_id)}, {"timezone": 1, "currency": 1, "name": 1}) or {}


# ── Receita ──
async def _summary(ws_id, start=None, end=None):
    match = {"workspace_id": ws_id, "type": {"$in": ["ftd", "deposit", "withdrawal"]}}
    if start:
        match["created_at"] = {"$gte": start, "$lt": end}
    agg = await db.events.aggregate([
        {"$match": match},
        {"$group": {"_id": "$type", "total": {"$sum": {"$ifNull": ["$value", 0]}}, "count": {"$sum": 1}}},
    ]).to_list(10)
    stats = {item["_id"]: item for item in agg}
    ftd = stats.get("ftd", {})
    dep = stats.get("deposit", {})
    wd = stats.get("withdrawal", {})
    deposits = dep.get("total", 0) + ftd.get("total", 0)
    withdrawals = wd.get("total", 0)
    # Gasto de campanha não tem data: é acumulado e só entra na visão total.
    spend = None
    if start is None:
        s = await db.campaigns.aggregate([
            {"$match": {"workspace_id": ws_id}},
            {"$group": {"_id": None, "v": {"$sum": {"$ifNull": ["$metrics.spend", 0]}}}},
        ]).to_list(1)
        spend = s[0]["v"] if s else 0
    net = deposits - withdrawals
    ftds = ftd.get("count", 0)
    return {
        "deposits": deposits, "deposit_count": dep.get("count", 0) + ftds,
        "withdrawals": withdrawals, "withdrawal_count": wd.get("count", 0),
        "net_deposit": net, "ftds": ftds, "ftd_value": ftd.get("total", 0),
        "spend": spend,
        "cpftd": round(spend / ftds, 2) if spend is not None and ftds else None,
        "roi": round((net - spend) / spend * 100, 1) if spend else None,
    }


@router.get("/revenue")
async def get_revenue(request: Request, period: str = "30d"):
    user = await get_current_user(request)
    ws = await _workspace(user["workspace_id"])
    if period == "all":
        summary = await _summary(user["workspace_id"])
        previous = None
    else:
        try:
            prev_start, start, end = resolve_period(period)
        except ValueError as exc:
            raise HTTPException(400, str(exc))
        summary = await _summary(user["workspace_id"], start, end)
        previous = await _summary(user["workspace_id"], prev_start, start)
    return {
        "summary": summary, "previous": previous, "period": period,
        "currency": ws.get("currency", "BRL"),
        "note": None if period == "all" else "Investimento, CPFTD e ROI só aparecem na visão total: o gasto das campanhas ainda não é registrado por dia.",
    }


@router.get("/revenue/cohorts")
async def get_cohorts(request: Request, weeks: int = 12):
    """Coortes pela semana de entrada do player: quantos converteram e quanto renderam."""
    user = await get_current_user(request)
    ws = await _workspace(user["workspace_id"])
    tz = workspace_tz(ws.get("timezone"))
    weeks = max(1, min(weeks, 52))
    rows = await db.players.aggregate([
        {"$match": {"workspace_id": user["workspace_id"]}},
        {"$group": {
            "_id": {"$dateToString": {"format": "%G-S%V", "date": "$created_at", "timezone": getattr(tz, "key", "UTC")}},
            "players": {"$sum": 1},
            "ftds": {"$sum": {"$cond": [{"$eq": ["$has_ftd", True]}, 1, 0]}},
            "deposits": {"$sum": {"$ifNull": ["$total_deposits", 0]}},
            "withdrawals": {"$sum": {"$ifNull": ["$total_withdrawals", 0]}},
        }},
        {"$sort": {"_id": -1}},
        {"$limit": weeks},
    ]).to_list(weeks)
    cohorts = []
    for r in rows:
        net = r["deposits"] - r["withdrawals"]
        cohorts.append({
            "week": r["_id"], "players": r["players"], "ftds": r["ftds"],
            "ftd_rate": round(r["ftds"] / r["players"] * 100, 1) if r["players"] else None,
            "deposits": r["deposits"], "withdrawals": r["withdrawals"], "net": net,
            "ltv": round(net / r["players"], 2) if r["players"] else None,
        })
    return {"cohorts": cohorts, "currency": ws.get("currency", "BRL")}


@router.get("/revenue/reconciliation")
async def list_reconciliations(request: Request):
    user = await get_current_user(request)
    items = await db.reconciliations.find({"workspace_id": user["workspace_id"]},
                                          {"result.mismatched": 0, "result.missing_in_ledger": 0, "result.missing_in_file": 0}) \
        .sort("created_at", -1).limit(50).to_list(50)
    for i in items:
        i["_id"] = str(i["_id"])
    return {"items": items}


@router.post("/revenue/reconciliation")
async def run_reconciliation(request: Request):
    """Confronta o extrato da casa (CSV lido na tela) com o ledger no mesmo intervalo."""
    user = await get_current_user(request)
    body = await _body(request)
    rows = body.get("rows") or []
    if not isinstance(rows, list) or not rows:
        raise HTTPException(400, "Envie as linhas do extrato (transaction_id e amount)")
    if len(rows) > 50000:
        raise HTTPException(400, "Extrato acima de 50.000 linhas: divida por período")
    try:
        start = datetime.fromisoformat(str(body["start"]).replace("Z", "+00:00"))
        end = datetime.fromisoformat(str(body["end"]).replace("Z", "+00:00"))
    except (KeyError, ValueError):
        raise HTTPException(400, "Informe o início e o fim do período do extrato")
    if start.tzinfo is None or end <= start:
        raise HTTPException(400, "Período inválido")
    types = body.get("types") or ["ftd", "deposit"]
    ledger = {}
    async for e in db.events.find({"workspace_id": user["workspace_id"], "metadata.provider": "tap",
                                   "type": {"$in": types}, "created_at": {"$gte": start, "$lt": end}},
                                  {"external_id": 1, "value": 1}):
        if e.get("external_id"):
            ledger[e["external_id"]] = e.get("value") or 0
    result = reconcile(rows, ledger)
    doc = {"workspace_id": user["workspace_id"], "provider": "tap", "label": (body.get("label") or "").strip() or None,
           "start": start, "end": end, "types": types, "result": result,
           "created_by": user["_id"], "created_at": datetime.now(timezone.utc)}
    doc["_id"] = str((await db.reconciliations.insert_one(doc)).inserted_id)
    await audit(user, "revenue.reconcile", doc["_id"], "reconciliation")
    return doc


@router.get("/revenue/reconciliation/{rec_id}")
async def get_reconciliation(rec_id: str, request: Request):
    user = await get_current_user(request)
    doc = await db.reconciliations.find_one({"_id": _oid_or_404(rec_id, "Conciliação"), "workspace_id": user["workspace_id"]})
    if not doc:
        raise HTTPException(404, "Conciliação não encontrada")
    doc["_id"] = str(doc["_id"])
    return doc


@router.get("/revenue/periods")
async def list_closed_periods(request: Request):
    user = await get_current_user(request)
    items = await db.revenue_periods.find({"workspace_id": user["workspace_id"]}).sort("start", -1).to_list(100)
    for i in items:
        i["_id"] = str(i["_id"])
    return {"items": items}


@router.post("/revenue/periods")
async def close_period(request: Request):
    """Fecha um período: grava o resultado como está. Snapshot não muda depois."""
    user = await get_current_user(request)
    body = await _body(request)
    try:
        start = datetime.fromisoformat(str(body["start"]).replace("Z", "+00:00"))
        end = datetime.fromisoformat(str(body["end"]).replace("Z", "+00:00"))
    except (KeyError, ValueError):
        raise HTTPException(400, "Informe início e fim do período")
    now = datetime.now(timezone.utc)
    if start.tzinfo is None or end <= start:
        raise HTTPException(400, "Período inválido")
    if end > now:
        raise HTTPException(400, "Só dá para fechar período que já terminou")
    async for other in db.revenue_periods.find({"workspace_id": user["workspace_id"]}, {"start": 1, "end": 1, "label": 1}):
        if periods_overlap(start, end, other["start"], other["end"]):
            raise HTTPException(400, f"Sobrepõe o período já fechado “{other.get('label')}”")
    doc = {
        "workspace_id": user["workspace_id"], "label": (body.get("label") or "").strip() or f"{start:%d/%m/%Y}–{end:%d/%m/%Y}",
        "start": start, "end": end, "summary": await _summary(user["workspace_id"], start, end),
        "closed_by": user["_id"], "closed_by_name": user.get("name", ""), "closed_at": now,
    }
    doc["_id"] = str((await db.revenue_periods.insert_one(doc)).inserted_id)
    await audit(user, "revenue.close_period", doc["_id"], "revenue_period")
    return doc


# ── Relatórios ──
def _dimension_expr(dim, tz_key):
    if dim == "day":
        return {"$dateToString": {"format": "%Y-%m-%d", "date": "$created_at", "timezone": tz_key}}
    if dim == "campaign":
        return {"$ifNull": ["$attribution.campaign_id", "$metadata.campaign_id"]}
    if dim == "link":
        return {"$ifNull": ["$attribution.link_id", "$metadata.link_id"]}
    return "$source"


async def compute_report(ws_id, report):
    dims = [d for d in report.get("dimensions") or [] if d in REPORT_DIMENSIONS][:2] or ["source"]
    metrics = [m for m in report.get("metrics") or [] if m in REPORT_METRICS] or list(REPORT_METRICS)
    ws = await _workspace(ws_id)
    tz = workspace_tz(ws.get("timezone"))
    _, start, end = resolve_period(REPORT_PERIODS.get(report.get("period") or "7d", "7d"))
    group_id = {d: _dimension_expr(d, getattr(tz, "key", "UTC")) for d in dims}
    group_id["type"] = "$type"
    raw = await db.events.aggregate([
        {"$match": {"workspace_id": ws_id, "created_at": {"$gte": start, "$lt": end}}},
        {"$group": {"_id": group_id, "count": {"$sum": 1}, "value": {"$sum": {"$ifNull": ["$value", 0]}}}},
    ]).to_list(20000)

    # Nomes legíveis para campanha e link.
    names = {}
    for dim, coll in (("campaign", "campaigns"), ("link", "tracking_links")):
        if dim in dims:
            ids = {r["_id"].get(dim) for r in raw if ObjectId.is_valid(str(r["_id"].get(dim) or ""))}
            async for d in db[coll].find({"_id": {"$in": [ObjectId(i) for i in ids]}}, {"name": 1}):
                names[str(d["_id"])] = d.get("name")

    buckets = {}
    for r in raw:
        key = []
        for d in dims:
            v = r["_id"].get(d)
            if d == "source":
                v = normalize_source(v)
            elif d in ("campaign", "link"):
                v = names.get(str(v), v) if v else "—"
            key.append(v or "—")
        b = buckets.setdefault(tuple(key), {})
        t = b.setdefault(r["_id"]["type"], {"count": 0, "value": 0})
        t["count"] += r["count"]
        t["value"] += r["value"]
    rows = []
    for key, counts in buckets.items():
        m = row_metrics(counts)
        rows.append({**dict(zip(dims, key)), **{k: m[k] for k in metrics}})
    rows.sort(key=lambda row: tuple(str(row[d]) for d in dims))
    columns = [{"key": d, "label": REPORT_DIMENSIONS[d]} for d in dims] + [{"key": m, "label": REPORT_METRICS[m]} for m in metrics]
    return {"columns": columns, "rows": rows, "start": start, "end": end, "currency": ws.get("currency", "BRL")}


async def _run_and_store(ws_id, report, trigger, user_id=None):
    data = await compute_report(ws_id, report)
    snap = {"workspace_id": ws_id, "report_id": str(report["_id"]), "report_name": report.get("name"),
            "trigger": trigger, "generated_by": user_id, "generated_at": datetime.now(timezone.utc), **data}
    snap["_id"] = str((await db.report_snapshots.insert_one(snap)).inserted_id)
    await db.reports.update_one({"_id": report["_id"]}, {"$set": {"last_run_at": snap["generated_at"], "status": "published"}})
    return snap


async def run_due_reports():
    """Chamado pelo monitor periódico: executa relatórios agendados vencidos."""
    now = datetime.now(timezone.utc)
    async for report in db.reports.find({"schedule.next_run_at": {"$lte": now}}):
        ws_id = report["workspace_id"]
        try:
            snap = await _run_and_store(ws_id, report, "scheduled")
            await notify(ws_id, "report_ready", f"Relatório pronto: {report.get('name')}",
                         f"{len(snap['rows'])} linhas · {report.get('period')}",
                         link=f"/reports?report={report['_id']}&snapshot={snap['_id']}",
                         user_ids=report["schedule"].get("user_ids") or None)
        except Exception as exc:  # noqa: BLE001 — relatório quebrado não para os outros
            await db.reports.update_one({"_id": report["_id"]}, {"$set": {"schedule.last_error": str(exc)[:200]}})
        ws = await _workspace(ws_id)
        await db.reports.update_one({"_id": report["_id"]}, {"$set": {
            "schedule.next_run_at": next_run(report["schedule"], now, workspace_tz(ws.get("timezone")))}})


@router.get("/reports")
async def list_reports(request: Request, page: int = 1, limit: int = 50):
    user = await get_current_user(request)
    query = {"workspace_id": user["workspace_id"]}
    total = await db.reports.count_documents(query)
    items = await db.reports.find(query).sort("created_at", -1).skip((page - 1) * limit).limit(limit).to_list(limit)
    for item in items:
        item["_id"] = str(item["_id"])
    return {"items": items, "total": total, "page": page, "pages": math.ceil(total / limit) if total else 1,
            "catalog": {"metrics": REPORT_METRICS, "dimensions": REPORT_DIMENSIONS, "periods": list(REPORT_PERIODS)}}


@router.post("/reports")
async def create_report(body: ReportCreate, request: Request):
    user = await get_current_user(request)
    bad = [m for m in body.metrics if m not in REPORT_METRICS] + [d for d in body.dimensions if d not in REPORT_DIMENSIONS]
    if bad:
        raise HTTPException(400, f"Métrica ou dimensão desconhecida: {', '.join(bad)}")
    if len(body.dimensions) > 2:
        raise HTTPException(400, "No máximo 2 dimensões")
    if body.period and body.period not in REPORT_PERIODS:
        raise HTTPException(400, "Período deve ser 1d, 7d, 30d ou 90d")
    now = datetime.now(timezone.utc)
    doc = {
        "workspace_id": user["workspace_id"], "name": body.name, "type": body.type,
        "metrics": body.metrics, "dimensions": body.dimensions, "period": body.period or "7d",
        "filters": body.filters, "status": "draft", "schedule": None,
        "created_at": now, "updated_at": now, "created_by": user["_id"],
    }
    result = await db.reports.insert_one(doc)
    doc["_id"] = str(result.inserted_id)
    await audit(user, "report.create", doc["_id"], "report")
    return doc


async def _report_or_404(report_id, ws_id):
    doc = await db.reports.find_one({"_id": _oid_or_404(report_id, "Relatório"), "workspace_id": ws_id})
    if not doc:
        raise HTTPException(404, "Relatório não encontrado")
    return doc


@router.post("/reports/{report_id}/run")
async def run_report(report_id: str, request: Request):
    user = await get_current_user(request)
    report = await _report_or_404(report_id, user["workspace_id"])
    return await _run_and_store(user["workspace_id"], report, "manual", user["_id"])


@router.put("/reports/{report_id}/schedule")
async def schedule_report(report_id: str, request: Request):
    user = await get_current_user(request)
    report = await _report_or_404(report_id, user["workspace_id"])
    body = await _body(request)
    if body.get("frequency") in (None, "", "none"):
        await db.reports.update_one({"_id": report["_id"]}, {"$set": {"schedule": None}})
        return {"schedule": None}
    if body["frequency"] not in FREQUENCIES:
        raise HTTPException(400, "Frequência deve ser daily, weekly ou monthly")
    try:
        schedule = {"frequency": body["frequency"], "hour": int(body.get("hour", 8)),
                    "weekday": int(body.get("weekday", 0)), "day": int(body.get("day", 1))}
    except (TypeError, ValueError):
        raise HTTPException(400, "Hora, dia da semana e dia do mês devem ser números")
    if not (0 <= schedule["hour"] <= 23 and 0 <= schedule["weekday"] <= 6 and 1 <= schedule["day"] <= 28):
        raise HTTPException(400, "Hora 0–23, dia da semana 0–6 e dia do mês 1–28")
    members = {str(m["_id"]) async for m in db.users.find({"workspace_id": user["workspace_id"]}, {"_id": 1})}
    user_ids = [u for u in body.get("user_ids") or [] if u in members]
    ws = await _workspace(user["workspace_id"])
    schedule.update({
        "user_ids": user_ids,
        # Guardado para quando houver provedor de e-mail; hoje a entrega é no app/Telegram.
        "emails": [e.strip().lower() for e in body.get("emails") or [] if "@" in str(e)],
        "next_run_at": next_run(schedule, datetime.now(timezone.utc), workspace_tz(ws.get("timezone"))),
    })
    await db.reports.update_one({"_id": report["_id"]}, {"$set": {"schedule": schedule, "updated_at": datetime.now(timezone.utc)}})
    await audit(user, "report.schedule", report_id, "report")
    return {"schedule": schedule}


@router.get("/reports/{report_id}/snapshots")
async def list_snapshots(report_id: str, request: Request):
    user = await get_current_user(request)
    await _report_or_404(report_id, user["workspace_id"])
    items = await db.report_snapshots.find({"report_id": report_id, "workspace_id": user["workspace_id"]},
                                           {"rows": 0}).sort("generated_at", -1).limit(50).to_list(50)
    for i in items:
        i["_id"] = str(i["_id"])
    return {"items": items}


@router.get("/reports/{report_id}/snapshots/{snapshot_id}")
async def get_snapshot(report_id: str, snapshot_id: str, request: Request):
    user = await get_current_user(request)
    snap = await db.report_snapshots.find_one({"_id": _oid_or_404(snapshot_id, "Snapshot"), "report_id": report_id,
                                               "workspace_id": user["workspace_id"]})
    if not snap:
        raise HTTPException(404, "Snapshot não encontrado")
    snap["_id"] = str(snap["_id"])
    return snap


@router.get("/reports/{report_id}/snapshots/{snapshot_id}/export.csv")
async def export_snapshot_csv(report_id: str, snapshot_id: str, request: Request):
    snap = await get_snapshot(report_id, snapshot_id, request)
    cols = snap["columns"]

    def cell(value):
        # Decimal com vírgula: o Excel em português lê como número.
        return csv_escape(str(value).replace(".", ",") if isinstance(value, float) else value)

    lines = [";".join(csv_escape(c["label"]) for c in cols)]
    lines += [";".join(cell(row.get(c["key"], "")) for c in cols) for row in snap["rows"]]
    filename = f"{(snap.get('report_name') or 'relatorio').replace(' ', '_')}_{snap['generated_at']:%Y%m%d_%H%M}.csv"
    # BOM + ";" abre certo no Excel em português.
    return Response("﻿" + "\r\n".join(lines), media_type="text/csv; charset=utf-8",
                    headers={"Content-Disposition": f'attachment; filename="{filename}"'})


@router.delete("/reports/{report_id}")
async def delete_report(report_id: str, request: Request):
    user = await get_current_user(request)
    report = await _report_or_404(report_id, user["workspace_id"])
    await db.reports.delete_one({"_id": report["_id"]})
    await db.report_snapshots.delete_many({"report_id": report_id})
    return {"detail": "Removido"}


# ── Governança ──
async def _kill_switch_states(ws_id):
    saved = {k["key"]: k async for k in db.kill_switches.find({"workspace_id": ws_id})}
    return [{
        "key": key, "label": label, "active": bool((saved.get(key) or {}).get("active")),
        "reason": (saved.get(key) or {}).get("reason"), "changed_at": (saved.get(key) or {}).get("changed_at"),
        "changed_by_name": (saved.get(key) or {}).get("changed_by_name"),
    } for key, label in KILL_SWITCHES.items()]


@router.get("/governance")
async def get_governance(request: Request):
    user = await get_current_user(request)
    ws_id = user["workspace_id"]
    policies = await db.governance_policies.find({"workspace_id": ws_id}).sort("created_at", -1).to_list(100)
    for p in policies:
        p["_id"] = str(p["_id"])
    return {"policies": policies, "kill_switches": await _kill_switch_states(ws_id), "policy_types": POLICY_TYPES}


@router.put("/governance/kill-switches/{key}")
async def set_kill_switch(key: str, request: Request):
    """Ligado = a função fica BLOQUEADA no workspace até alguém desligar."""
    user = await get_current_user(request)
    if key not in KILL_SWITCHES:
        raise HTTPException(404, "Kill switch desconhecido")
    body = await _body(request)
    active = body.get("active")
    if not isinstance(active, bool):
        raise HTTPException(400, "Informe active: true ou false")
    reason = (body.get("reason") or "").strip()
    if active and len(reason) < 5:
        raise HTTPException(400, "Explique por que está bloqueando (mínimo 5 caracteres)")
    now = datetime.now(timezone.utc)
    await db.kill_switches.update_one({"workspace_id": user["workspace_id"], "key": key}, {"$set": {
        "active": active, "reason": reason or None, "changed_by": user["_id"],
        "changed_by_name": user.get("name", ""), "changed_at": now}}, upsert=True)
    await audit(user, f"kill_switch.{'on' if active else 'off'}", key, "kill_switch")
    await notify(user["workspace_id"], "kill_switch",
                 f"{KILL_SWITCHES[key]} {'bloqueado' if active else 'liberado'}",
                 f"{user.get('name') or user.get('email')}: {reason or 'sem motivo'}", link="/governance")
    return {"key": key, "active": active}


@router.post("/governance/policies")
async def create_policy(request: Request):
    user = await get_current_user(request)
    body = await _body(request)
    name = (body.get("name") or "").strip()
    ptype = body.get("type")
    config = body.get("config") or {}
    errors = ([] if name else ["Dê um nome à política"]) + policy_errors(ptype, config)
    if errors:
        raise HTTPException(400, "; ".join(errors))
    now = datetime.now(timezone.utc)
    doc = {"workspace_id": user["workspace_id"], "name": name, "type": ptype, "config": config,
           "description": (body.get("description") or "").strip() or None,
           "status": "active" if body.get("status", "active") == "active" else "inactive",
           "created_by": user["_id"], "created_at": now, "updated_at": now}
    doc["_id"] = str((await db.governance_policies.insert_one(doc)).inserted_id)
    await audit(user, "policy.create", doc["_id"], "policy")
    return doc


@router.put("/governance/policies/{policy_id}")
async def update_policy(policy_id: str, request: Request):
    user = await get_current_user(request)
    current = await db.governance_policies.find_one({"_id": _oid_or_404(policy_id, "Política"), "workspace_id": user["workspace_id"]})
    if not current:
        raise HTTPException(404, "Política não encontrada")
    body = await _body(request)
    update = {"updated_at": datetime.now(timezone.utc)}
    if "name" in body:
        update["name"] = (body["name"] or "").strip() or current["name"]
    if "description" in body:
        update["description"] = (body["description"] or "").strip() or None
    if "status" in body:
        if body["status"] not in ("active", "inactive"):
            raise HTTPException(400, "Status deve ser active ou inactive")
        update["status"] = body["status"]
    if "config" in body:
        errors = policy_errors(current["type"], body["config"] or {})
        if errors:
            raise HTTPException(400, "; ".join(errors))
        update["config"] = body["config"]
    await db.governance_policies.update_one({"_id": current["_id"]}, {"$set": update})
    await audit(user, "policy.update", policy_id, "policy")
    return {"detail": "Política atualizada"}


@router.delete("/governance/policies/{policy_id}")
async def delete_policy(policy_id: str, request: Request):
    user = await get_current_user(request)
    result = await db.governance_policies.delete_one({"_id": _oid_or_404(policy_id, "Política"), "workspace_id": user["workspace_id"]})
    if not result.deleted_count:
        raise HTTPException(404, "Política não encontrada")
    await audit(user, "policy.delete", policy_id, "policy")
    return {"detail": "Removida"}


@router.get("/approvals")
async def list_approvals(request: Request, status: str = None, page: int = 1, limit: int = 50):
    user = await get_current_user(request)
    query = {"workspace_id": user["workspace_id"]}
    if status:
        query["status"] = status
    total = await db.approvals.count_documents(query)
    items = await db.approvals.find(query).sort("created_at", -1).skip((page - 1) * limit).limit(limit).to_list(limit)
    for item in items:
        item["_id"] = str(item["_id"])
    return {"items": items, "total": total, "page": page, "pages": math.ceil(total / limit) if total else 1}


async def create_approval_doc(user, type_, object_id, object_type, plan, justification):
    now = datetime.now(timezone.utc)
    doc = {
        "workspace_id": user["workspace_id"], "type": type_, "object_id": object_id, "object_type": object_type,
        "plan": plan, "justification": justification, "status": "pending",
        "proposed_by": user["_id"], "proposed_by_name": user.get("name", ""),
        "decided_by": None, "decision_at": None, "expires_at": None, "created_at": now,
    }
    doc["_id"] = str((await db.approvals.insert_one(doc)).inserted_id)
    await notify(user["workspace_id"], "approval_pending", "Aprovação aguardando decisão",
                 f"{user.get('name') or user.get('email')} propôs {type_} em {object_type}.", link="/approvals")
    return doc


@router.post("/approvals")
async def create_approval(body: ApprovalCreate, request: Request):
    user = await get_current_user(request)
    return await create_approval_doc(user, body.type, body.object_id, body.object_type, body.plan, body.justification)


@router.post("/approvals/{approval_id}/decide")
async def decide_approval(approval_id: str, request: Request):
    user = await get_current_user(request)
    body = await _body(request)
    decision = body.get("decision")
    if decision not in ("approved", "rejected"):
        raise HTTPException(400, "Decisão deve ser 'approved' ou 'rejected'")
    approval = await db.approvals.find_one({"_id": _oid_or_404(approval_id, "Aprovação"),
                                            "workspace_id": user["workspace_id"], "status": "pending"})
    if not approval:
        raise HTTPException(404, "Aprovação não encontrada ou já decidida")
    # Quem propôs não aprova a própria proposta — a não ser que esteja sozinho no workspace.
    if decision == "approved" and approval.get("proposed_by") == user["_id"] and \
            await db.users.count_documents({"workspace_id": user["workspace_id"]}) > 1:
        raise HTTPException(403, "Quem propôs não pode aprovar a própria proposta")
    now = datetime.now(timezone.utc)
    await db.approvals.update_one({"_id": approval["_id"]}, {"$set": {
        "status": decision, "decided_by": user["_id"], "decided_by_name": user.get("name", ""),
        "decision_at": now, "decision_note": (body.get("note") or "").strip() or None}})
    if approval["type"] == "dispatch_send" and ObjectId.is_valid(str(approval["object_id"])):
        dispatch = await db.dispatches.find_one({"_id": ObjectId(approval["object_id"]), "status": "awaiting_approval"})
        if dispatch:
            if decision == "approved":
                scheduled = dispatch.get("scheduled_at")
                status = "scheduled" if scheduled and scheduled > now else "queued"
            else:
                status = "draft"
            await db.dispatches.update_one({"_id": dispatch["_id"]}, {"$set": {
                "status": status, "approved_by": user["_id"] if decision == "approved" else None}})
    await audit(user, f"approval.{decision}", approval_id, "approval")
    return {"detail": f"Aprovação {'aprovada' if decision == 'approved' else 'rejeitada'}"}
