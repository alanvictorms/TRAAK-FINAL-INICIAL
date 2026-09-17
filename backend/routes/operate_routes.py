from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import StreamingResponse
from datetime import datetime, timezone
from bson import ObjectId
from database import db
from auth import get_current_user
from messaging import send_channel_message
from realtime import inbox_events
from models import (
    ConversationCreate, MessageCreate, SegmentCreate,
    AutomationCreate, AutomationUpdate, DispatchCreate, CampaignCreate,
    LeadDetailUpdate, LeadTaskCreate,
)
import math
import asyncio
import json

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


@router.get("/inbox/events")
async def stream_inbox_events(request: Request):
    """Push inbox invalidations to the authenticated workspace via SSE."""
    user = await get_current_user(request)
    workspace_id = user["workspace_id"]

    async def event_stream():
        queue = inbox_events.subscribe(workspace_id)
        try:
            yield "event: connected\ndata: {}\n\n"
            while True:
                if await request.is_disconnected():
                    break
                try:
                    event = await asyncio.wait_for(queue.get(), timeout=20)
                    yield f"event: inbox\ndata: {json.dumps(event, default=str)}\n\n"
                except asyncio.TimeoutError:
                    yield ": keep-alive\n\n"
        finally:
            inbox_events.unsubscribe(workspace_id, queue)

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@router.get("/inbox/{conversation_id}")
async def get_conversation(conversation_id: str, request: Request):
    user = await get_current_user(request)
    if not ObjectId.is_valid(conversation_id):
        raise HTTPException(404, "Conversa não encontrada")
    doc = await db.conversations.find_one({"_id": ObjectId(conversation_id), "workspace_id": user["workspace_id"]})
    if not doc:
        raise HTTPException(404, "Conversa não encontrada")
    doc["_id"] = str(doc["_id"])
    messages = await db.messages.find({"conversation_id": conversation_id}).sort("created_at", 1).to_list(500)
    for m in messages:
        m["_id"] = str(m["_id"])
    doc["messages"] = messages
    player = None
    player_id = doc.get("player_id")
    if player_id and ObjectId.is_valid(player_id):
        player = await db.players.find_one({"_id": ObjectId(player_id), "workspace_id": user["workspace_id"]})
    if player:
        tasks = await db.lead_tasks.find({
            "workspace_id": user["workspace_id"], "player_id": player_id,
        }).sort("created_at", -1).to_list(50)
        for task in tasks:
            task["_id"] = str(task["_id"])
        events = await db.events.find({
            "workspace_id": user["workspace_id"], "person_id": player_id,
        }).sort("created_at", -1).limit(20).to_list(20)
        runs = await db.automation_runs.find({
            "workspace_id": user["workspace_id"], "player_id": player_id,
        }).sort("created_at", -1).limit(20).to_list(20)
        message_count = await db.messages.count_documents({
            "workspace_id": user["workspace_id"], "conversation_id": conversation_id,
        })
        contact = player.get("contact") or {}
        external_ids = player.get("external_ids") or {}
        activity = [{
            "type": "automation",
            "label": "Entrou em uma automação",
            "detail": run.get("status", "queued"),
            "at": run.get("created_at"),
        } for run in runs]
        activity.extend({
            "type": "event",
            "label": event.get("type", "Evento").replace("_", " ").title(),
            "detail": event.get("status", ""),
            "at": event.get("created_at"),
        } for event in events)
        activity.append({
            "type": "conversation",
            "label": "Conversa iniciada",
            "detail": doc.get("channel", ""),
            "at": doc.get("created_at"),
        })
        activity.sort(
            key=lambda item: item["at"].timestamp() if isinstance(item.get("at"), datetime) else 0,
            reverse=True,
        )
        first_message_at = messages[0].get("created_at") if messages else doc.get("created_at")
        if first_message_at and first_message_at.tzinfo is None:
            first_message_at = first_message_at.replace(tzinfo=timezone.utc)
        doc["lead"] = {
            "_id": player_id,
            "name": player.get("name") or doc.get("player_name"),
            "status": player.get("status", "active"),
            "pipeline_stage": player.get("pipeline_stage", "Sem etapa"),
            "expert_name": player.get("expert_name") or doc.get("assigned_name") or "Não atribuído",
            "budget": player.get("budget", 0),
            "phone": contact.get("phone") or external_ids.get("phone") or external_ids.get("whatsapp_user_id"),
            "email": contact.get("email") or external_ids.get("email"),
            "origin": player.get("origin") or doc.get("channel"),
            "tags": player.get("tags", []),
            "internal_notes": player.get("internal_notes", ""),
            "blocked": player.get("blocked", False),
            "total_deposits": player.get("total_deposits", 0),
            "total_withdrawals": player.get("total_withdrawals", 0),
            "ftd_value": player.get("ftd_value", 0),
            "has_ftd": player.get("has_ftd", False),
            "utm": player.get("utm", {}),
            "external_ids": external_ids,
            "tasks": tasks,
            "message_count": message_count,
            "engagement_days": max(1, (datetime.now(timezone.utc) - first_message_at).days + 1) if first_message_at else 1,
            "activity": activity[:30],
            "created_at": player.get("created_at"),
        }
    if doc.get("unread_count"):
        await db.conversations.update_one({"_id": ObjectId(conversation_id)}, {"$set": {"unread_count": 0}})
        doc["unread_count"] = 0
    return doc


@router.put("/inbox/{conversation_id}/lead")
async def update_conversation_lead(conversation_id: str, body: LeadDetailUpdate, request: Request):
    user = await get_current_user(request)
    if not ObjectId.is_valid(conversation_id):
        raise HTTPException(404, "Conversa não encontrada")
    conversation = await db.conversations.find_one({
        "_id": ObjectId(conversation_id), "workspace_id": user["workspace_id"],
    })
    if not conversation or not ObjectId.is_valid(conversation.get("player_id", "")):
        raise HTTPException(404, "Lead da conversa não encontrado")
    update = {"updated_at": datetime.now(timezone.utc)}
    for field in ("name", "status", "pipeline_stage", "expert_name", "budget", "tags", "internal_notes", "blocked"):
        value = getattr(body, field)
        if value is not None:
            update[field] = value
    if body.phone is not None:
        update["contact.phone"] = body.phone
    if body.email is not None:
        update["contact.email"] = body.email
    result = await db.players.update_one(
        {"_id": ObjectId(conversation["player_id"]), "workspace_id": user["workspace_id"]},
        {"$set": update},
    )
    if result.matched_count == 0:
        raise HTTPException(404, "Lead não encontrado")
    conversation_update = {"updated_at": datetime.now(timezone.utc)}
    if body.name is not None:
        conversation_update["player_name"] = body.name
    if body.blocked is True:
        conversation_update.update({"status": "resolved", "close_reason": "blocked"})
    await db.conversations.update_one({"_id": conversation["_id"]}, {"$set": conversation_update})
    await inbox_events.publish(user["workspace_id"], {"type": "lead.updated", "conversation_id": conversation_id})
    return {"detail": "Lead atualizado"}


@router.post("/inbox/{conversation_id}/tasks")
async def create_lead_task(conversation_id: str, body: LeadTaskCreate, request: Request):
    user = await get_current_user(request)
    if not body.title.strip() or not ObjectId.is_valid(conversation_id):
        raise HTTPException(400, "Título da tarefa obrigatório")
    conversation = await db.conversations.find_one({
        "_id": ObjectId(conversation_id), "workspace_id": user["workspace_id"],
    })
    if not conversation:
        raise HTTPException(404, "Conversa não encontrada")
    now = datetime.now(timezone.utc)
    task = {
        "workspace_id": user["workspace_id"], "player_id": conversation.get("player_id"),
        "conversation_id": conversation_id, "title": body.title.strip(), "due_at": body.due_at,
        "completed": False, "created_by": user["_id"], "created_at": now, "updated_at": now,
    }
    result = await db.lead_tasks.insert_one(task)
    task["_id"] = str(result.inserted_id)
    return task


@router.put("/inbox/{conversation_id}/tasks/{task_id}/toggle")
async def toggle_lead_task(conversation_id: str, task_id: str, request: Request):
    user = await get_current_user(request)
    if not ObjectId.is_valid(task_id):
        raise HTTPException(404, "Tarefa não encontrada")
    task = await db.lead_tasks.find_one({
        "_id": ObjectId(task_id), "conversation_id": conversation_id, "workspace_id": user["workspace_id"],
    })
    if not task:
        raise HTTPException(404, "Tarefa não encontrada")
    completed = not task.get("completed", False)
    await db.lead_tasks.update_one({"_id": task["_id"]}, {"$set": {"completed": completed, "updated_at": datetime.now(timezone.utc)}})
    return {"completed": completed}


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
    if not ObjectId.is_valid(conversation_id):
        raise HTTPException(404, "Conversa não encontrada")
    conv = await db.conversations.find_one({"_id": ObjectId(conversation_id), "workspace_id": user["workspace_id"]})
    if not conv:
        raise HTTPException(404, "Conversa não encontrada")
    now = datetime.now(timezone.utc)
    delivery = {"status": "internal"}
    if body.type == "reply":
        try:
            delivery = await send_channel_message(conv, body.content)
        except (ValueError, RuntimeError) as exc:
            raise HTTPException(400, str(exc))
        except Exception as exc:
            raise HTTPException(502, f"Falha ao enviar pelo canal: {exc}")
    msg = {
        "conversation_id": conversation_id,
        "workspace_id": user["workspace_id"],
        "sender_id": user["_id"],
        "sender_name": user.get("name", ""),
        "content": body.content,
        "type": body.type,
        "direction": "outbound" if body.type == "reply" else "internal",
        "delivery_status": delivery.get("status"),
        "created_at": now,
    }
    if delivery.get("external_id"):
        msg["external_id"] = delivery["external_id"]
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
    await inbox_events.publish(user["workspace_id"], {
        "type": "message.sent",
        "conversation_id": conversation_id,
        "message_id": msg["_id"],
    })
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
    if body.connection_id:
        connection = await db.integrations.find_one({
            "_id": ObjectId(body.connection_id) if ObjectId.is_valid(body.connection_id) else None,
            "workspace_id": user["workspace_id"],
            "provider": {"$in": ["telegram", "whatsapp"]},
        })
        if not connection:
            raise HTTPException(400, "Selecione uma conexão de WhatsApp ou Telegram válida")
    now = datetime.now(timezone.utc)
    doc = {
        "workspace_id": user["workspace_id"],
        "name": body.name,
        "trigger": body.trigger,
        "nodes": body.nodes,
        "edges": body.edges,
        "connection_id": body.connection_id,
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
    if not ObjectId.is_valid(automation_id):
        raise HTTPException(404, "Automação não encontrada")
    update = {"updated_at": datetime.now(timezone.utc)}
    if body.name is not None:
        update["name"] = body.name
    if body.status is not None:
        update["status"] = body.status
    if body.trigger is not None:
        update["trigger"] = body.trigger
    if body.nodes is not None:
        update["nodes"] = body.nodes
    if body.edges is not None:
        update["edges"] = body.edges
    if body.connection_id is not None:
        connection = await db.integrations.find_one({
            "_id": ObjectId(body.connection_id) if ObjectId.is_valid(body.connection_id) else None,
            "workspace_id": user["workspace_id"],
            "provider": {"$in": ["telegram", "whatsapp"]},
        })
        if not connection:
            raise HTTPException(400, "Selecione uma conexão de WhatsApp ou Telegram válida")
        update["connection_id"] = body.connection_id
    if body.status == "active":
        current = await db.automations.find_one({"_id": ObjectId(automation_id), "workspace_id": user["workspace_id"]})
        effective_connection = update.get("connection_id") or (current or {}).get("connection_id")
        if not effective_connection:
            raise HTTPException(400, "Selecione a conexão que executará a automação antes de publicar")
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


@router.get("/automations/{automation_id}/executions")
async def list_automation_executions(automation_id: str, request: Request, limit: int = 100):
    user = await get_current_user(request)
    automation = await db.automations.find_one({
        "_id": ObjectId(automation_id) if ObjectId.is_valid(automation_id) else None,
        "workspace_id": user["workspace_id"],
    })
    if not automation:
        raise HTTPException(404, "Automação não encontrada")
    items = await db.automation_runs.find({
        "automation_id": automation_id, "workspace_id": user["workspace_id"],
    }).sort("created_at", -1).limit(min(limit, 200)).to_list(min(limit, 200))
    player_ids = [ObjectId(item["player_id"]) for item in items if ObjectId.is_valid(item.get("player_id", ""))]
    players = await db.players.find({"_id": {"$in": player_ids}}).to_list(len(player_ids)) if player_ids else []
    names = {str(player["_id"]): player.get("name", "Lead") for player in players}
    for item in items:
        item["_id"] = str(item["_id"])
        item["player_name"] = names.get(item.get("player_id"), "Lead")
    return {"items": items, "total": len(items)}


@router.get("/automations/{automation_id}/analytics")
async def get_automation_analytics(automation_id: str, request: Request):
    user = await get_current_user(request)
    automation = await db.automations.find_one({
        "_id": ObjectId(automation_id) if ObjectId.is_valid(automation_id) else None,
        "workspace_id": user["workspace_id"],
    })
    if not automation:
        raise HTTPException(404, "Automação não encontrada")
    runs = await db.automation_runs.find({
        "automation_id": automation_id, "workspace_id": user["workspace_id"],
    }).sort("created_at", -1).to_list(5000)
    statuses = {}
    durations = []
    for run in runs:
        status = run.get("status", "queued")
        statuses[status] = statuses.get(status, 0) + 1
        if run.get("completed_at") and run.get("created_at"):
            durations.append((run["completed_at"] - run["created_at"]).total_seconds())
    completed = sum(statuses.get(key, 0) for key in ("completed", "converted"))
    waiting = sum(statuses.get(key, 0) for key in ("queued", "waiting", "running"))
    failed = statuses.get("failed", 0)
    node_hits = {}
    for run in runs:
        for node_id in run.get("visited_node_ids", []):
            node_hits[node_id] = node_hits.get(node_id, 0) + 1
    return {
        "total": len(runs), "completed": completed, "waiting": waiting, "failed": failed,
        "conversion_rate": round((completed / len(runs) * 100), 1) if runs else 0,
        "average_minutes": round(sum(durations) / len(durations) / 60, 1) if durations else 0,
        "node_hits": node_hits,
        "recent": [{
            "_id": str(run["_id"]), "player_id": run.get("player_id"), "status": run.get("status", "queued"),
            "current_node_id": run.get("current_node_id"), "created_at": run.get("created_at"),
        } for run in runs[:10]],
    }


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
