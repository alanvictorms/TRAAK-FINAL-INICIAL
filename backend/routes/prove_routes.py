from fastapi import APIRouter, HTTPException, Request
from datetime import datetime, timezone
from bson import ObjectId
from database import db
from auth import get_current_user
from models import ReportCreate, ApprovalCreate
import math

router = APIRouter(prefix="/api", tags=["prove"])


# ── Revenue ──
@router.get("/revenue")
async def get_revenue(request: Request, period: str = "30d"):
    user = await get_current_user(request)
    ws_id = user["workspace_id"]

    # Aggregate financial data from events
    pipeline = [
        {"$match": {"workspace_id": ws_id, "type": {"$in": ["ftd", "deposit", "withdrawal"]}}},
        {"$group": {
            "_id": "$type",
            "total": {"$sum": {"$ifNull": ["$value", 0]}},
            "count": {"$sum": 1},
        }},
    ]
    agg = await db.events.aggregate(pipeline).to_list(10)
    stats = {item["_id"]: {"total": item["total"], "count": item["count"]} for item in agg}

    deposits = stats.get("deposit", {"total": 0, "count": 0})["total"] + stats.get("ftd", {"total": 0, "count": 0})["total"]
    withdrawals = stats.get("withdrawal", {"total": 0, "count": 0})["total"]
    ftd_count = stats.get("ftd", {"total": 0, "count": 0})["count"]

    # Get media spend
    spend_pipeline = [
        {"$match": {"workspace_id": ws_id}},
        {"$group": {"_id": None, "total_spend": {"$sum": "$metrics.spend"}}},
    ]
    spend_agg = await db.campaigns.aggregate(spend_pipeline).to_list(1)
    total_spend = spend_agg[0]["total_spend"] if spend_agg else 0

    net_deposit = deposits - withdrawals
    cpftd = total_spend / ftd_count if ftd_count > 0 else None

    return {
        "summary": {
            "deposits": deposits,
            "deposit_count": stats.get("deposit", {"count": 0})["count"] + stats.get("ftd", {"count": 0})["count"],
            "withdrawals": withdrawals,
            "net_deposit": net_deposit,
            "ftds": ftd_count,
            "ftd_value": stats.get("ftd", {"total": 0})["total"],
            "spend": total_spend,
            "cpftd": cpftd,
            "roi": ((net_deposit - total_spend) / total_spend * 100) if total_spend > 0 else None,
        },
        "period": period,
        "currency": "BRL",
        "note": "ROI e métricas financeiras seguem definições pendentes (D05)",
    }


@router.get("/revenue/cohorts")
async def get_cohorts(request: Request):
    user = await get_current_user(request)
    # Cohort analysis by registration week
    pipeline = [
        {"$match": {"workspace_id": user["workspace_id"], "type": "ftd"}},
        {"$group": {
            "_id": {"$dateToString": {"format": "%Y-W%V", "date": "$created_at"}},
            "ftds": {"$sum": 1},
            "total_value": {"$sum": {"$ifNull": ["$value", 0]}},
        }},
        {"$sort": {"_id": -1}},
        {"$limit": 12},
    ]
    items = await db.events.aggregate(pipeline).to_list(12)
    return {"cohorts": items}


# ── Reports ──
@router.get("/reports")
async def list_reports(request: Request, page: int = 1, limit: int = 50):
    user = await get_current_user(request)
    query = {"workspace_id": user["workspace_id"]}
    total = await db.reports.count_documents(query)
    items = await db.reports.find(query).sort("created_at", -1).skip((page - 1) * limit).limit(limit).to_list(limit)
    for item in items:
        item["_id"] = str(item["_id"])
    return {"items": items, "total": total, "page": page, "pages": math.ceil(total / limit) if total else 1}


@router.post("/reports")
async def create_report(body: ReportCreate, request: Request):
    user = await get_current_user(request)
    now = datetime.now(timezone.utc)
    doc = {
        "workspace_id": user["workspace_id"],
        "name": body.name,
        "type": body.type,
        "metrics": body.metrics,
        "dimensions": body.dimensions,
        "period": body.period,
        "filters": body.filters,
        "status": "draft",
        "snapshots": [],
        "schedule": None,
        "created_at": now,
        "updated_at": now,
        "created_by": user["_id"],
    }
    result = await db.reports.insert_one(doc)
    doc["_id"] = str(result.inserted_id)
    return doc


@router.delete("/reports/{report_id}")
async def delete_report(report_id: str, request: Request):
    user = await get_current_user(request)
    result = await db.reports.delete_one({"_id": ObjectId(report_id), "workspace_id": user["workspace_id"]})
    if result.deleted_count == 0:
        raise HTTPException(404, "Relatório não encontrado")
    return {"detail": "Removido"}


# ── Governance / Approvals ──
@router.get("/governance")
async def get_governance(request: Request):
    user = await get_current_user(request)
    ws_id = user["workspace_id"]
    policies = await db.governance_policies.find({"workspace_id": ws_id}).to_list(100)
    for p in policies:
        p["_id"] = str(p["_id"])
    kill_switches = await db.kill_switches.find({"workspace_id": ws_id}).to_list(100)
    for k in kill_switches:
        k["_id"] = str(k["_id"])
    return {"policies": policies, "kill_switches": kill_switches}


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


@router.post("/approvals")
async def create_approval(body: ApprovalCreate, request: Request):
    user = await get_current_user(request)
    now = datetime.now(timezone.utc)
    doc = {
        "workspace_id": user["workspace_id"],
        "type": body.type,
        "object_id": body.object_id,
        "object_type": body.object_type,
        "plan": body.plan,
        "justification": body.justification,
        "status": "pending",
        "proposed_by": user["_id"],
        "proposed_by_name": user.get("name", ""),
        "decided_by": None,
        "decision_at": None,
        "expires_at": None,
        "created_at": now,
    }
    result = await db.approvals.insert_one(doc)
    doc["_id"] = str(result.inserted_id)
    return doc


@router.post("/approvals/{approval_id}/decide")
async def decide_approval(approval_id: str, request: Request):
    user = await get_current_user(request)
    body = await request.json()
    decision = body.get("decision")
    if decision not in ("approved", "rejected"):
        raise HTTPException(400, "Decisão deve ser 'approved' ou 'rejected'")
    result = await db.approvals.update_one(
        {"_id": ObjectId(approval_id), "workspace_id": user["workspace_id"], "status": "pending"},
        {"$set": {"status": decision, "decided_by": user["_id"], "decision_at": datetime.now(timezone.utc)}},
    )
    if result.matched_count == 0:
        raise HTTPException(404, "Aprovação não encontrada ou já decidida")
    return {"detail": f"Aprovação {decision}"}
