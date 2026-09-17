from fastapi import APIRouter, HTTPException, Request
from datetime import datetime, timezone
from bson import ObjectId
from database import db
from auth import get_current_user
from models import EventCreate, PlayerCreate, PlayerUpdate
import math
import re

router = APIRouter(prefix="/api", tags=["observe"])


# ── Signal Ledger ──
@router.get("/ledger")
async def list_events(request: Request, type: str = None, status: str = None, search: str = None, page: int = 1, limit: int = 50):
    user = await get_current_user(request)
    query = {"workspace_id": user["workspace_id"]}
    if type:
        query["type"] = type
    if status:
        query["status"] = status
    if search:
        query["$or"] = [
            {"external_id": {"$regex": re.escape(search), "$options": "i"}},
            {"person_id": {"$regex": re.escape(search), "$options": "i"}},
        ]
    total = await db.events.count_documents(query)
    items = await db.events.find(query).sort("created_at", -1).skip((page - 1) * limit).limit(limit).to_list(limit)
    for item in items:
        item["_id"] = str(item["_id"])
    return {"items": items, "total": total, "page": page, "pages": math.ceil(total / limit) if total else 1}


@router.get("/ledger/{event_id}")
async def get_event(event_id: str, request: Request):
    user = await get_current_user(request)
    try:
        doc = await db.events.find_one({"_id": ObjectId(event_id), "workspace_id": user["workspace_id"]})
    except Exception:
        raise HTTPException(404, "Evento não encontrado")
    if not doc:
        raise HTTPException(404, "Evento não encontrado")
    doc["_id"] = str(doc["_id"])
    return doc


@router.post("/ledger")
async def create_event(body: EventCreate, request: Request):
    user = await get_current_user(request)
    now = datetime.now(timezone.utc)

    # Deduplication check
    if body.external_id:
        existing = await db.events.find_one({
            "external_id": body.external_id,
            "type": body.type,
            "workspace_id": user["workspace_id"],
        })
        if existing:
            existing["_id"] = str(existing["_id"])
            existing["duplicate"] = True
            return existing

    doc = {
        "workspace_id": user["workspace_id"],
        "type": body.type,
        "person_id": body.person_id,
        "source": body.source,
        "value": body.value,
        "currency": body.currency or "BRL",
        "external_id": body.external_id,
        "metadata": body.metadata,
        "status": "captured",
        "latency_ms": None,
        "attempts": [{"at": now.isoformat(), "status": "received"}],
        "attribution": None,
        "fact_at": now,
        "received_at": now,
        "created_at": now,
    }

    # If person_id provided, try to link
    if body.person_id:
        player = await db.players.find_one({"_id": ObjectId(body.person_id), "workspace_id": user["workspace_id"]})
        if player:
            doc["status"] = "linked"
            # Update player stats
            update_fields = {"updated_at": now}
            if body.type == "ftd":
                update_fields["has_ftd"] = True
                update_fields["ftd_at"] = now
                if body.value:
                    update_fields["ftd_value"] = body.value
            if body.type in ("deposit", "ftd") and body.value:
                await db.players.update_one({"_id": ObjectId(body.person_id)}, {"$inc": {"total_deposits": body.value}, "$set": update_fields})
            elif body.type == "withdrawal" and body.value:
                await db.players.update_one({"_id": ObjectId(body.person_id)}, {"$inc": {"total_withdrawals": body.value}, "$set": update_fields})
            else:
                await db.players.update_one({"_id": ObjectId(body.person_id)}, {"$set": update_fields})
    else:
        doc["status"] = "orphan"

    result = await db.events.insert_one(doc)
    doc["_id"] = str(result.inserted_id)
    return doc


# ── Players ──
@router.get("/players")
async def list_players(request: Request, search: str = None, origin: str = None, expert: str = None, ftd_only: bool = False, page: int = 1, limit: int = 50):
    user = await get_current_user(request)
    query = {"workspace_id": user["workspace_id"]}
    if search:
        query["$or"] = [
            {"name": {"$regex": re.escape(search), "$options": "i"}},
            {"external_ids": {"$regex": re.escape(search), "$options": "i"}},
        ]
    if origin:
        query["origin"] = origin
    if expert:
        query["expert_id"] = expert
    if ftd_only:
        query["has_ftd"] = True
    total = await db.players.count_documents(query)
    items = await db.players.find(query).sort("created_at", -1).skip((page - 1) * limit).limit(limit).to_list(limit)
    for item in items:
        item["_id"] = str(item["_id"])
    return {"items": items, "total": total, "page": page, "pages": math.ceil(total / limit) if total else 1}


@router.get("/players/{player_id}")
async def get_player(player_id: str, request: Request):
    user = await get_current_user(request)
    doc = await db.players.find_one({"_id": ObjectId(player_id), "workspace_id": user["workspace_id"]})
    if not doc:
        raise HTTPException(404, "Player não encontrado")
    doc["_id"] = str(doc["_id"])
    # Fetch related events
    events = await db.events.find({"person_id": player_id, "workspace_id": user["workspace_id"]}).sort("created_at", -1).limit(50).to_list(50)
    for e in events:
        e["_id"] = str(e["_id"])
    doc["events"] = events
    # Fetch conversations
    convos = await db.conversations.find({"player_id": player_id, "workspace_id": user["workspace_id"]}).sort("updated_at", -1).limit(10).to_list(10)
    for c in convos:
        c["_id"] = str(c["_id"])
    doc["conversations"] = convos
    return doc


@router.post("/players")
async def create_player(body: PlayerCreate, request: Request):
    user = await get_current_user(request)
    now = datetime.now(timezone.utc)
    doc = {
        "workspace_id": user["workspace_id"],
        "name": body.name,
        "external_ids": body.external_ids,
        "origin": body.origin,
        "expert_id": body.expert_id,
        "tags": body.tags,
        "score": 0,
        "status": "active",
        "has_ftd": False,
        "ftd_at": None,
        "ftd_value": None,
        "total_deposits": 0,
        "total_withdrawals": 0,
        "created_at": now,
        "updated_at": now,
    }
    result = await db.players.insert_one(doc)
    doc["_id"] = str(result.inserted_id)
    return doc


@router.put("/players/{player_id}")
async def update_player(player_id: str, body: PlayerUpdate, request: Request):
    user = await get_current_user(request)
    update = {"updated_at": datetime.now(timezone.utc)}
    if body.name is not None:
        update["name"] = body.name
    if body.tags is not None:
        update["tags"] = body.tags
    if body.origin is not None:
        update["origin"] = body.origin
    result = await db.players.update_one(
        {"_id": ObjectId(player_id), "workspace_id": user["workspace_id"]},
        {"$set": update},
    )
    if result.matched_count == 0:
        raise HTTPException(404, "Player não encontrado")
    return {"detail": "Atualizado"}


@router.delete("/players/{player_id}")
async def delete_player(player_id: str, request: Request):
    user = await get_current_user(request)
    result = await db.players.delete_one({"_id": ObjectId(player_id), "workspace_id": user["workspace_id"]})
    if result.deleted_count == 0:
        raise HTTPException(404, "Player não encontrado")
    return {"detail": "Removido"}


# ── Identity Graph ──
@router.get("/identity")
async def list_identities(request: Request, search: str = None, page: int = 1, limit: int = 50):
    user = await get_current_user(request)
    query = {"workspace_id": user["workspace_id"]}
    if search:
        query["$or"] = [{"name": {"$regex": re.escape(search), "$options": "i"}}]
    # Identity graph is built from players + their identifiers
    total = await db.players.count_documents(query)
    items = await db.players.find(query, {"name": 1, "external_ids": 1, "origin": 1, "status": 1, "score": 1}).sort("created_at", -1).skip((page - 1) * limit).limit(limit).to_list(limit)
    for item in items:
        item["_id"] = str(item["_id"])
        item["identifiers"] = list(item.get("external_ids", {}).keys())
        item["confidence"] = "high" if len(item.get("external_ids", {})) > 1 else "medium"
    return {"items": items, "total": total, "page": page, "pages": math.ceil(total / limit) if total else 1}


# ── Monitoring ──
@router.get("/monitoring")
async def get_monitoring(request: Request):
    user = await get_current_user(request)
    ws_id = user["workspace_id"]
    # Get integration health
    integrations = await db.integrations.find({"workspace_id": ws_id}).to_list(100)
    health = []
    for intg in integrations:
        health.append({
            "id": str(intg["_id"]),
            "name": intg["name"],
            "provider": intg["provider"],
            "status": intg["status"],
            "last_sync": intg.get("last_sync"),
            "last_test": intg.get("last_test"),
        })

    # DLQ - failed events
    dlq_count = await db.events.count_documents({"workspace_id": ws_id, "status": "failed"})
    dlq_items = await db.events.find({"workspace_id": ws_id, "status": "failed"}).sort("created_at", -1).limit(20).to_list(20)
    for item in dlq_items:
        item["_id"] = str(item["_id"])

    return {
        "integrations": health,
        "dlq": {"count": dlq_count, "items": dlq_items},
        "metrics": {
            "total_events_24h": await db.events.count_documents({"workspace_id": ws_id}),
            "failed_24h": dlq_count,
        },
    }


@router.post("/monitoring/reprocess/{event_id}")
async def reprocess_event(event_id: str, request: Request):
    user = await get_current_user(request)
    doc = await db.events.find_one({"_id": ObjectId(event_id), "workspace_id": user["workspace_id"]})
    if not doc:
        raise HTTPException(404, "Evento não encontrado")
    now = datetime.now(timezone.utc)
    await db.events.update_one(
        {"_id": ObjectId(event_id)},
        {
            "$set": {"status": "captured", "updated_at": now},
            "$push": {"attempts": {"at": now.isoformat(), "status": "reprocessed", "by": user["_id"]}},
        },
    )
    return {"detail": "Evento reenfileirado para reprocessamento"}
