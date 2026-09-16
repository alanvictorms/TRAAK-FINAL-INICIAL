from fastapi import APIRouter, HTTPException, Request
from datetime import datetime, timezone
from bson import ObjectId
from database import db
from auth import get_current_user
from models import (
    ConversationCreate, MessageCreate, SegmentCreate,
    AutomationCreate, AutomationUpdate, DispatchCreate, CampaignCreate,
)
import math

router = APIRouter(prefix="/api", tags=["operate"])


# ── Inbox / Conversations ──
@router.get("/inbox")
async def list_conversations(request: Request, status: str = None, search: str = None, page: int = 1, limit: int = 50):
    user = await get_current_user(request)
    query = {"workspace_id": user["workspace_id"]}
    if status:
        query["status"] = status
    if search:
        query["$or"] = [
            {"subject": {"$regex": search, "$options": "i"}},
            {"player_name": {"$regex": search, "$options": "i"}},
        ]
    total = await db.conversations.count_documents(query)
    items = await db.conversations.find(query).sort("updated_at", -1).skip((page - 1) * limit).limit(limit).to_list(limit)
    for item in items:
        item["_id"] = str(item["_id"])
    return {"items": items, "total": total, "page": page, "pages": math.ceil(total / limit) if total else 1}


@router.get("/inbox/{conversation_id}")
async def get_conversation(conversation_id: str, request: Request):
    user = await get_current_user(request)
    doc = await db.conversations.find_one({"_id": ObjectId(conversation_id), "workspace_id": user["workspace_id"]})
    if not doc:
        raise HTTPException(404, "Conversa não encontrada")
    doc["_id"] = str(doc["_id"])
    messages = await db.messages.find({"conversation_id": conversation_id}).sort("created_at", 1).to_list(500)
    for m in messages:
        m["_id"] = str(m["_id"])
    doc["messages"] = messages
    return doc


@router.post("/inbox")
async def create_conversation(body: ConversationCreate, request: Request):
    user = await get_current_user(request)
    now = datetime.now(timezone.utc)
    player = await db.players.find_one({"_id": ObjectId(body.player_id), "workspace_id": user["workspace_id"]})
    doc = {
        "workspace_id": user["workspace_id"],
        "player_id": body.player_id,
        "player_name": player.get("name", "Desconhecido") if player else "Desconhecido",
        "channel": body.channel,
        "subject": body.subject or "Nova conversa",
        "status": "queue",
        "assigned_to": None,
        "assigned_name": None,
        "tags": [],
        "close_reason": None,
        "first_response_at": None,
        "created_at": now,
        "updated_at": now,
    }
    result = await db.conversations.insert_one(doc)
    doc["_id"] = str(result.inserted_id)
    return doc


@router.post("/inbox/{conversation_id}/messages")
async def send_message(conversation_id: str, body: MessageCreate, request: Request):
    user = await get_current_user(request)
    conv = await db.conversations.find_one({"_id": ObjectId(conversation_id), "workspace_id": user["workspace_id"]})
    if not conv:
        raise HTTPException(404, "Conversa não encontrada")
    now = datetime.now(timezone.utc)
    msg = {
        "conversation_id": conversation_id,
        "workspace_id": user["workspace_id"],
        "sender_id": user["_id"],
        "sender_name": user.get("name", ""),
        "content": body.content,
        "type": body.type,
        "created_at": now,
    }
    result = await db.messages.insert_one(msg)
    msg["_id"] = str(result.inserted_id)

    update = {"updated_at": now, "last_message": body.content[:100]}
    if not conv.get("first_response_at") and body.type == "reply":
        update["first_response_at"] = now
    if conv.get("status") == "queue" and body.type == "reply":
        update["status"] = "active"
        update["assigned_to"] = user["_id"]
        update["assigned_name"] = user.get("name", "")
    await db.conversations.update_one({"_id": ObjectId(conversation_id)}, {"$set": update})
    return msg


@router.post("/inbox/{conversation_id}/assign")
async def assign_conversation(conversation_id: str, request: Request):
    user = await get_current_user(request)
    result = await db.conversations.update_one(
        {"_id": ObjectId(conversation_id), "workspace_id": user["workspace_id"]},
        {"$set": {"assigned_to": user["_id"], "assigned_name": user.get("name", ""), "status": "active", "updated_at": datetime.now(timezone.utc)}},
    )
    if result.matched_count == 0:
        raise HTTPException(404, "Conversa não encontrada")
    return {"detail": "Conversa assumida"}


@router.post("/inbox/{conversation_id}/close")
async def close_conversation(conversation_id: str, request: Request):
    user = await get_current_user(request)
    result = await db.conversations.update_one(
        {"_id": ObjectId(conversation_id), "workspace_id": user["workspace_id"]},
        {"$set": {"status": "resolved", "closed_at": datetime.now(timezone.utc), "updated_at": datetime.now(timezone.utc)}},
    )
    if result.matched_count == 0:
        raise HTTPException(404, "Conversa não encontrada")
    return {"detail": "Conversa encerrada"}


# ── Automations ──
@router.get("/automations")
async def list_automations(request: Request, status: str = None, page: int = 1, limit: int = 50):
    user = await get_current_user(request)
    query = {"workspace_id": user["workspace_id"]}
    if status:
        query["status"] = status
    total = await db.automations.count_documents(query)
    items = await db.automations.find(query).sort("created_at", -1).skip((page - 1) * limit).limit(limit).to_list(limit)
    for item in items:
        item["_id"] = str(item["_id"])
    return {"items": items, "total": total, "page": page, "pages": math.ceil(total / limit) if total else 1}


@router.get("/automations/{automation_id}")
async def get_automation(automation_id: str, request: Request):
    user = await get_current_user(request)
    doc = await db.automations.find_one({"_id": ObjectId(automation_id), "workspace_id": user["workspace_id"]})
    if not doc:
        raise HTTPException(404, "Automação não encontrada")
    doc["_id"] = str(doc["_id"])
    return doc


@router.post("/automations")
async def create_automation(body: AutomationCreate, request: Request):
    user = await get_current_user(request)
    now = datetime.now(timezone.utc)
    doc = {
        "workspace_id": user["workspace_id"],
        "name": body.name,
        "trigger": body.trigger,
        "nodes": body.nodes,
        "status": body.status,
        "version": 1,
        "executions": 0,
        "conversions": 0,
        "created_at": now,
        "updated_at": now,
        "created_by": user["_id"],
    }
    result = await db.automations.insert_one(doc)
    doc["_id"] = str(result.inserted_id)
    return doc


@router.put("/automations/{automation_id}")
async def update_automation(automation_id: str, body: AutomationUpdate, request: Request):
    user = await get_current_user(request)
    update = {"updated_at": datetime.now(timezone.utc)}
    if body.name is not None:
        update["name"] = body.name
    if body.status is not None:
        update["status"] = body.status
    if body.trigger is not None:
        update["trigger"] = body.trigger
    if body.nodes is not None:
        update["nodes"] = body.nodes
    result = await db.automations.update_one(
        {"_id": ObjectId(automation_id), "workspace_id": user["workspace_id"]},
        {"$set": update},
    )
    if result.matched_count == 0:
        raise HTTPException(404, "Automação não encontrada")
    return {"detail": "Atualizado"}


@router.delete("/automations/{automation_id}")
async def delete_automation(automation_id: str, request: Request):
    user = await get_current_user(request)
    result = await db.automations.delete_one({"_id": ObjectId(automation_id), "workspace_id": user["workspace_id"]})
    if result.deleted_count == 0:
        raise HTTPException(404, "Automação não encontrada")
    return {"detail": "Removido"}


# ── Segments ──
@router.get("/segments")
async def list_segments(request: Request, page: int = 1, limit: int = 50):
    user = await get_current_user(request)
    query = {"workspace_id": user["workspace_id"]}
    total = await db.segments.count_documents(query)
    items = await db.segments.find(query).sort("created_at", -1).skip((page - 1) * limit).limit(limit).to_list(limit)
    for item in items:
        item["_id"] = str(item["_id"])
    return {"items": items, "total": total, "page": page, "pages": math.ceil(total / limit) if total else 1}


@router.post("/segments")
async def create_segment(body: SegmentCreate, request: Request):
    user = await get_current_user(request)
    now = datetime.now(timezone.utc)
    doc = {
        "workspace_id": user["workspace_id"],
        "name": body.name,
        "conditions": body.conditions,
        "logic": body.logic,
        "count": 0,
        "last_evaluated": None,
        "created_at": now,
        "updated_at": now,
    }
    result = await db.segments.insert_one(doc)
    doc["_id"] = str(result.inserted_id)
    return doc


@router.delete("/segments/{segment_id}")
async def delete_segment(segment_id: str, request: Request):
    user = await get_current_user(request)
    result = await db.segments.delete_one({"_id": ObjectId(segment_id), "workspace_id": user["workspace_id"]})
    if result.deleted_count == 0:
        raise HTTPException(404, "Segmento não encontrado")
    return {"detail": "Removido"}


# ── Dispatches ──
@router.get("/disparos")
async def list_dispatches(request: Request, status: str = None, page: int = 1, limit: int = 50):
    user = await get_current_user(request)
    query = {"workspace_id": user["workspace_id"]}
    if status:
        query["status"] = status
    total = await db.dispatches.count_documents(query)
    items = await db.dispatches.find(query).sort("created_at", -1).skip((page - 1) * limit).limit(limit).to_list(limit)
    for item in items:
        item["_id"] = str(item["_id"])
    return {"items": items, "total": total, "page": page, "pages": math.ceil(total / limit) if total else 1}


@router.post("/disparos")
async def create_dispatch(body: DispatchCreate, request: Request):
    user = await get_current_user(request)
    now = datetime.now(timezone.utc)
    doc = {
        "workspace_id": user["workspace_id"],
        "name": body.name,
        "channel": body.channel,
        "segment_id": body.segment_id,
        "content": body.content,
        "scheduled_at": body.scheduled_at,
        "recurrence": body.recurrence,
        "status": "draft",
        "stats": {"target": 0, "eligible": 0, "sent": 0, "delivered": 0, "clicked": 0, "ftds": 0},
        "created_at": now,
        "updated_at": now,
        "created_by": user["_id"],
    }
    result = await db.dispatches.insert_one(doc)
    doc["_id"] = str(result.inserted_id)
    return doc


@router.delete("/disparos/{dispatch_id}")
async def delete_dispatch(dispatch_id: str, request: Request):
    user = await get_current_user(request)
    result = await db.dispatches.delete_one({"_id": ObjectId(dispatch_id), "workspace_id": user["workspace_id"]})
    if result.deleted_count == 0:
        raise HTTPException(404, "Disparo não encontrado")
    return {"detail": "Removido"}


# ── Campaigns ──
@router.get("/media")
async def list_campaigns(request: Request, platform: str = None, status: str = None, search: str = None, page: int = 1, limit: int = 50):
    user = await get_current_user(request)
    query = {"workspace_id": user["workspace_id"]}
    if platform:
        query["platform"] = platform
    if status:
        query["status"] = status
    if search:
        query["name"] = {"$regex": search, "$options": "i"}
    total = await db.campaigns.count_documents(query)
    items = await db.campaigns.find(query).sort("created_at", -1).skip((page - 1) * limit).limit(limit).to_list(limit)
    for item in items:
        item["_id"] = str(item["_id"])
    return {"items": items, "total": total, "page": page, "pages": math.ceil(total / limit) if total else 1}


@router.post("/media")
async def create_campaign(body: CampaignCreate, request: Request):
    user = await get_current_user(request)
    now = datetime.now(timezone.utc)
    doc = {
        "workspace_id": user["workspace_id"],
        "name": body.name,
        "platform": body.platform,
        "status": body.status,
        "budget": body.budget,
        "expert_id": body.expert_id,
        "metrics": {"spend": 0, "impressions": 0, "clicks": 0, "leads": 0, "registrations": 0, "ftds": 0, "deposits": 0},
        "created_at": now,
        "updated_at": now,
    }
    result = await db.campaigns.insert_one(doc)
    doc["_id"] = str(result.inserted_id)
    return doc


@router.delete("/media/{campaign_id}")
async def delete_campaign(campaign_id: str, request: Request):
    user = await get_current_user(request)
    result = await db.campaigns.delete_one({"_id": ObjectId(campaign_id), "workspace_id": user["workspace_id"]})
    if result.deleted_count == 0:
        raise HTTPException(404, "Campanha não encontrada")
    return {"detail": "Removido"}
