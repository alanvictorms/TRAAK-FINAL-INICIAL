from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import StreamingResponse
from datetime import datetime, timedelta, timezone
from bson import ObjectId
from database import db, audit, active_policy, is_killed
from auth import get_current_user
from messaging import send_channel_message, notify
from analytics import CLOSE_REASONS
from automation_engine import GraphError, simulate as simulate_graph, validate as validate_graph
from segments import FIELDS as SEGMENT_FIELDS, SegmentError, segment_query
from dispatch_runner import eligible_recipients, variants_of
from media_sync import sync_workspace
from realtime import inbox_events
from models import (
    ConversationCreate, MessageCreate, SegmentCreate,
    AutomationCreate, AutomationUpdate, DispatchCreate, CampaignCreate,
    LeadDetailUpdate, LeadTaskCreate,
)
import math
import re
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
            {"subject": {"$regex": re.escape(search), "$options": "i"}},
            {"player_name": {"$regex": re.escape(search), "$options": "i"}},
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


async def _known_tags(workspace_id, tags):
    """Devolve (etiquetas válidas na grafia do catálogo, desconhecidas)."""
    if not isinstance(tags, list):
        raise HTTPException(400, "Envie tags como lista")
    catalog = {t["name"].lower(): t["name"] async for t in db.workspace_tags.find({"workspace_id": workspace_id}, {"name": 1})}
    clean, unknown = [], []
    for raw in tags:
        name = catalog.get(str(raw).strip().lower())
        if not name:
            unknown.append(str(raw).strip()[:40])
        elif name not in clean:
            clean.append(name)
    return clean, unknown


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
    if body.tags is not None:
        clean, unknown = await _known_tags(user["workspace_id"], body.tags)
        if unknown:
            raise HTTPException(400, f"Etiqueta não cadastrada na workspace: {', '.join(unknown)}")
        body.tags = clean
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
    return await deliver_message(user, conv, body)


async def deliver_message(user, conv, body: MessageCreate):
    """Envia pelo canal da conversa (resposta) ou só grava (nota interna)."""
    conversation_id = str(conv["_id"])
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


async def _body(request: Request) -> dict:
    """Corpo JSON opcional: chamadas antigas não mandam nada."""
    try:
        data = await request.json()
    except Exception:  # noqa: BLE001
        return {}
    return data if isinstance(data, dict) else {}


async def _conversation_or_404(conversation_id, ws_id):
    if not ObjectId.is_valid(conversation_id):
        raise HTTPException(404, "Conversa não encontrada")
    conv = await db.conversations.find_one({"_id": ObjectId(conversation_id), "workspace_id": ws_id})
    if not conv:
        raise HTTPException(404, "Conversa não encontrada")
    return conv


@router.get("/inbox/meta/options")
async def inbox_options(request: Request):
    """Atendentes para transferência e motivos de encerramento."""
    user = await get_current_user(request)
    members = await db.users.find({"workspace_id": user["workspace_id"]}, {"name": 1, "email": 1, "role": 1}).to_list(200)
    return {
        "agents": [{"id": str(m["_id"]), "name": m.get("name") or m.get("email"), "role": m.get("role")} for m in members],
        "close_reasons": [{"key": k, "label": v} for k, v in CLOSE_REASONS.items()],
    }


@router.post("/inbox/{conversation_id}/assign")
async def assign_conversation(conversation_id: str, request: Request):
    """Sem corpo: assume a conversa. Com {user_id}: transfere para outro atendente."""
    user = await get_current_user(request)
    conv = await _conversation_or_404(conversation_id, user["workspace_id"])
    body = await _body(request)
    target_id = body.get("user_id") or user["_id"]
    if target_id == user["_id"]:
        target = user
    else:
        if not ObjectId.is_valid(str(target_id)):
            raise HTTPException(400, "Atendente inválido")
        target = await db.users.find_one({"_id": ObjectId(target_id), "workspace_id": user["workspace_id"]})
        if not target:
            raise HTTPException(400, "Atendente não pertence a este workspace")
        target["_id"] = str(target["_id"])
    now = datetime.now(timezone.utc)
    await db.conversations.update_one({"_id": conv["_id"]}, {"$set": {
        "assigned_to": target["_id"], "assigned_name": target.get("name", ""),
        "status": "active", "updated_at": now,
    }})
    transferred = target["_id"] != user["_id"]
    if transferred:
        note = (body.get("note") or "").strip()
        await db.messages.insert_one({
            "conversation_id": conversation_id, "workspace_id": user["workspace_id"],
            "sender_id": user["_id"], "sender_name": user.get("name", ""),
            "content": f"Transferida para {target.get('name') or target.get('email')}" + (f": {note}" if note else ""),
            "type": "system", "direction": "internal", "created_at": now,
        })
        await notify(
            user["workspace_id"], "conversation_transfer",
            "Conversa transferida para você",
            f"{user.get('name') or user.get('email')} passou {conv.get('player_name') or 'uma conversa'} para você.",
            link=f"/inbox/{conversation_id}", user_ids=[target["_id"]],
        )
        await inbox_events.publish(user["workspace_id"], {"type": "conversation.assigned", "conversation_id": conversation_id})
    await audit(user, "inbox.transfer" if transferred else "inbox.assign", conversation_id, "conversation")
    return {"detail": "Conversa transferida" if transferred else "Conversa assumida",
            "assigned_to": target["_id"], "assigned_name": target.get("name", "")}


@router.post("/inbox/{conversation_id}/close")
async def close_conversation(conversation_id: str, request: Request):
    user = await get_current_user(request)
    conv = await _conversation_or_404(conversation_id, user["workspace_id"])
    body = await _body(request)
    reason = body.get("reason")
    if reason is not None and reason not in CLOSE_REASONS:
        raise HTTPException(400, "Motivo de encerramento inválido")
    now = datetime.now(timezone.utc)
    await db.conversations.update_one({"_id": conv["_id"]}, {"$set": {
        "status": "resolved", "closed_at": now, "closed_by": user["_id"],
        "close_reason": reason, "close_note": (body.get("note") or "").strip() or None,
        "updated_at": now,
    }})
    await inbox_events.publish(user["workspace_id"], {"type": "conversation.closed", "conversation_id": conversation_id})
    return {"detail": "Conversa encerrada"}


@router.put("/inbox/{conversation_id}/tags")
async def set_conversation_tags(conversation_id: str, request: Request):
    user = await get_current_user(request)
    conv = await _conversation_or_404(conversation_id, user["workspace_id"])
    body = await _body(request)
    tags = body.get("tags")
    if not isinstance(tags, list):
        raise HTTPException(400, "Envie tags como lista")
    clean, unknown = await _known_tags(user["workspace_id"], tags)
    if unknown:
        raise HTTPException(400, f"Etiqueta não cadastrada na workspace: {', '.join(unknown)}")
    if len(clean) > 20:
        raise HTTPException(400, "No máximo 20 etiquetas por conversa")
    await db.conversations.update_one({"_id": conv["_id"]}, {"$set": {"tags": clean, "updated_at": datetime.now(timezone.utc)}})
    await inbox_events.publish(user["workspace_id"], {"type": "conversation.updated", "conversation_id": conversation_id})
    return {"tags": clean}


@router.post("/players/{player_id}/message")
async def message_player(player_id: str, request: Request):
    """Mensagem direta da ficha do player, pelo canal escolhido.

    Usa a conversa aberta do player naquele canal; se não houver e o canal
    for Telegram, abre uma no chat privado do player (o bot só consegue
    escrever para quem já iniciou conversa com ele).
    """
    user = await get_current_user(request)
    ws_id = user["workspace_id"]
    body = await _body(request)
    content = (body.get("content") or "").strip()
    integration_id = body.get("integration_id")
    if not content:
        raise HTTPException(400, "Escreva a mensagem")
    if not ObjectId.is_valid(player_id):
        raise HTTPException(404, "Player não encontrado")
    player = await db.players.find_one({"_id": ObjectId(player_id), "workspace_id": ws_id})
    if not player:
        raise HTTPException(404, "Player não encontrado")
    if not integration_id or not ObjectId.is_valid(integration_id):
        raise HTTPException(400, "Escolha o canal")
    integration = await db.integrations.find_one({"_id": ObjectId(integration_id), "workspace_id": ws_id})
    if not integration:
        raise HTTPException(400, "Canal não encontrado neste workspace")

    conv = await db.conversations.find_one(
        {"workspace_id": ws_id, "player_id": player_id, "integration_id": integration_id},
        sort=[("updated_at", -1)],
    )
    created = False
    if not conv:
        created = True
        provider = integration.get("provider")
        chat_id = (player.get("external_ids") or {}).get(f"{provider}_user_id")
        if not chat_id:
            raise HTTPException(400, f"Player sem identificador em {provider}: ele precisa ter falado com esse canal antes")
        now = datetime.now(timezone.utc)
        conv = {
            "workspace_id": ws_id, "player_id": player_id, "player_name": player.get("name"),
            "channel": provider, "integration_id": integration_id,
            "integration_name": integration.get("name"), "external_chat_id": chat_id,
            "subject": "Mensagem enviada pela ficha do player", "status": "active",
            "assigned_to": user["_id"], "assigned_name": user.get("name", ""),
            "tags": [], "unread_count": 0, "created_at": now, "updated_at": now,
        }
        conv["_id"] = (await db.conversations.insert_one(conv)).inserted_id
    elif conv.get("status") == "resolved":
        # Reabrir é o esperado: a mensagem nova é continuação da conversa.
        await db.conversations.update_one({"_id": conv["_id"]}, {"$set": {"status": "active"}})
    try:
        msg = await deliver_message(user, conv, MessageCreate(content=content, type="reply"))
    except HTTPException:
        # Envio falhou: conversa aberta agora não fica vazia no Inbox.
        if created:
            await db.conversations.delete_one({"_id": conv["_id"]})
        raise
    await audit(user, "player.message", player_id, "player")
    return {"conversation_id": str(conv["_id"]), "message": msg}


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
        if current and not current.get("published"):
            await _publish(user, {**current, **update})
            update.pop("status")
    result = await db.automations.update_one(
        {"_id": ObjectId(automation_id), "workspace_id": user["workspace_id"]},
        {"$set": update},
    )
    if result.matched_count == 0:
        raise HTTPException(404, "Automação não encontrada")
    return {"detail": "Atualizado"}


async def _automation_or_404(automation_id, ws_id):
    if not ObjectId.is_valid(automation_id):
        raise HTTPException(404, "Automação não encontrada")
    doc = await db.automations.find_one({"_id": ObjectId(automation_id), "workspace_id": ws_id})
    if not doc:
        raise HTTPException(404, "Automação não encontrada")
    return doc


async def _publish(user, automation, changelog=""):
    graph = {"nodes": automation.get("nodes") or [], "edges": automation.get("edges") or []}
    problems = validate_graph(graph)
    if problems:
        raise HTTPException(400, "Não dá para publicar: " + "; ".join(problems))
    if not automation.get("connection_id"):
        raise HTTPException(400, "Selecione a conexão que executará a automação antes de publicar")
    now = datetime.now(timezone.utc)
    version = int((automation.get("published") or {}).get("version") or 0) + 1
    snapshot = {"version": version, "nodes": graph["nodes"], "edges": graph["edges"],
                "published_at": now, "published_by": user["_id"], "published_by_name": user.get("name", "")}
    # Versão publicada é imutável: só se cria outra.
    await db.automation_versions.insert_one({
        "automation_id": str(automation["_id"]), "workspace_id": user["workspace_id"],
        "changelog": (changelog or "").strip() or None, **snapshot,
    })
    await db.automations.update_one({"_id": automation["_id"]}, {"$set": {
        "published": snapshot, "status": "active", "version": version, "updated_at": now}})
    await audit(user, "automation.publish", str(automation["_id"]), "automation")
    return version


@router.post("/automations/{automation_id}/publish")
async def publish_automation(automation_id: str, request: Request):
    user = await get_current_user(request)
    automation = await _automation_or_404(automation_id, user["workspace_id"])
    body = await _body(request)
    version = await _publish(user, automation, body.get("changelog"))
    return {"detail": f"Versão {version} publicada", "version": version}


@router.get("/automations/{automation_id}/versions")
async def list_automation_versions(automation_id: str, request: Request):
    user = await get_current_user(request)
    await _automation_or_404(automation_id, user["workspace_id"])
    items = await db.automation_versions.find(
        {"automation_id": automation_id, "workspace_id": user["workspace_id"]},
        {"nodes": 0, "edges": 0},
    ).sort("version", -1).to_list(100)
    for item in items:
        item["_id"] = str(item["_id"])
    return {"items": items}


@router.post("/automations/{automation_id}/versions/{version}/restore")
async def restore_automation_version(automation_id: str, version: int, request: Request):
    """Traz uma versão antiga para o rascunho. Não publica: publicar cria outra versão."""
    user = await get_current_user(request)
    automation = await _automation_or_404(automation_id, user["workspace_id"])
    snap = await db.automation_versions.find_one({"automation_id": automation_id, "version": version,
                                                  "workspace_id": user["workspace_id"]})
    if not snap:
        raise HTTPException(404, "Versão não encontrada")
    await db.automations.update_one({"_id": automation["_id"]}, {"$set": {
        "nodes": snap["nodes"], "edges": snap["edges"], "updated_at": datetime.now(timezone.utc)}})
    await audit(user, "automation.restore", automation_id, "automation")
    return {"detail": f"Versão {version} carregada no rascunho", "nodes": snap["nodes"], "edges": snap["edges"]}


@router.post("/automations/{automation_id}/test")
async def test_automation(automation_id: str, request: Request):
    """Simula o rascunho sem enviar nada, sem mexer em lead nenhum."""
    user = await get_current_user(request)
    automation = await _automation_or_404(automation_id, user["workspace_id"])
    body = await _body(request)
    graph = {"nodes": body.get("nodes", automation.get("nodes") or []),
             "edges": body.get("edges", automation.get("edges") or [])}
    ctx = {
        "message": str(body.get("message") or ""),
        "player_name": str(body.get("player_name") or "Lead de teste"),
        "tags": [str(t).lower() for t in body.get("tags") or []],
        "has_ftd": bool(body.get("has_ftd")),
        "source": body.get("source") or None,
        "stage": body.get("stage") or None,
    }
    try:
        transcript = simulate_graph(graph, ctx, [str(r) for r in body.get("replies") or []])
    except GraphError as exc:
        raise HTTPException(400, str(exc))
    return {"problems": validate_graph(graph), "transcript": transcript}


@router.get("/automations/{automation_id}/runs/{run_id}")
async def get_automation_run(automation_id: str, run_id: str, request: Request):
    user = await get_current_user(request)
    if not ObjectId.is_valid(run_id):
        raise HTTPException(404, "Execução não encontrada")
    run = await db.automation_runs.find_one({"_id": ObjectId(run_id), "automation_id": automation_id,
                                             "workspace_id": user["workspace_id"]}, {"nodes": 0, "edges": 0})
    if not run:
        raise HTTPException(404, "Execução não encontrada")
    run["_id"] = str(run["_id"])
    return run


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
    }, {"nodes": 0, "edges": 0}).sort("created_at", -1).limit(min(limit, 200)).to_list(min(limit, 200))
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
async def _segment_or_404(segment_id, ws_id):
    if not ObjectId.is_valid(segment_id):
        raise HTTPException(404, "Segmento não encontrado")
    doc = await db.segments.find_one({"_id": ObjectId(segment_id), "workspace_id": ws_id})
    if not doc:
        raise HTTPException(404, "Segmento não encontrado")
    return doc


def _query_or_400(ws_id, conditions, logic):
    try:
        return segment_query(ws_id, conditions, logic)
    except SegmentError as exc:
        raise HTTPException(400, str(exc))


@router.get("/segments")
async def list_segments(request: Request, page: int = 1, limit: int = 50):
    user = await get_current_user(request)
    ws_id = user["workspace_id"]
    query = {"workspace_id": ws_id}
    total = await db.segments.count_documents(query)
    items = await db.segments.find(query).sort("created_at", -1).skip((page - 1) * limit).limit(limit).to_list(limit)
    now = datetime.now(timezone.utc)
    for item in items:
        item["_id"] = str(item["_id"])
        # Contagem ao vivo: segmento é dinâmico.
        try:
            item["count"] = await db.players.count_documents(segment_query(ws_id, item.get("conditions"), item.get("logic", "and")))
            item["last_evaluated"] = now
        except SegmentError as exc:
            item["count"], item["error"] = None, str(exc)
    return {"items": items, "total": total, "page": page, "pages": math.ceil(total / limit) if total else 1,
            "fields": SEGMENT_FIELDS}


@router.post("/segments/preview")
async def preview_segment(request: Request):
    user = await get_current_user(request)
    body = await _body(request)
    query = _query_or_400(user["workspace_id"], body.get("conditions"), body.get("logic", "and"))
    count = await db.players.count_documents(query)
    sample = await db.players.find(query, {"name": 1, "source": 1, "has_ftd": 1}).limit(10).to_list(10)
    return {"count": count, "sample": [{"id": str(p["_id"]), "name": p.get("name"), "source": p.get("source"),
                                        "has_ftd": p.get("has_ftd", False)} for p in sample]}


@router.post("/segments")
async def create_segment(body: SegmentCreate, request: Request):
    user = await get_current_user(request)
    query = _query_or_400(user["workspace_id"], body.conditions, body.logic)
    now = datetime.now(timezone.utc)
    doc = {
        "workspace_id": user["workspace_id"],
        "name": body.name,
        "conditions": body.conditions,
        "logic": body.logic,
        "count": await db.players.count_documents(query),
        "last_evaluated": now,
        "created_at": now,
        "updated_at": now,
    }
    result = await db.segments.insert_one(doc)
    doc["_id"] = str(result.inserted_id)
    await audit(user, "segment.create", doc["_id"], "segment")
    return doc


@router.get("/segments/{segment_id}/members")
async def segment_members(segment_id: str, request: Request, limit: int = 50):
    user = await get_current_user(request)
    seg = await _segment_or_404(segment_id, user["workspace_id"])
    query = _query_or_400(user["workspace_id"], seg.get("conditions"), seg.get("logic", "and"))
    items = await db.players.find(query, {"name": 1, "source": 1, "has_ftd": 1, "total_deposits": 1, "tags": 1}) \
        .sort("created_at", -1).limit(min(limit, 200)).to_list(min(limit, 200))
    for p in items:
        p["_id"] = str(p["_id"])
    return {"items": items, "total": await db.players.count_documents(query)}


@router.delete("/segments/{segment_id}")
async def delete_segment(segment_id: str, request: Request):
    user = await get_current_user(request)
    seg = await _segment_or_404(segment_id, user["workspace_id"])
    if await db.dispatches.find_one({"segment_id": segment_id, "status": {"$in": ["scheduled", "queued", "sending"]}}):
        raise HTTPException(400, "Há disparo pendente usando este segmento")
    await db.segments.delete_one({"_id": seg["_id"]})
    await audit(user, "segment.delete", segment_id, "segment")
    return {"detail": "Removido"}


# ── Disparos: templates ──
@router.get("/disparos/templates")
async def list_templates(request: Request):
    user = await get_current_user(request)
    items = await db.message_templates.find({"workspace_id": user["workspace_id"]}).sort("name", 1).to_list(200)
    for t in items:
        t["_id"] = str(t["_id"])
    return {"items": items}


@router.post("/disparos/templates")
async def create_template(request: Request):
    user = await get_current_user(request)
    body = await _body(request)
    name, text = (body.get("name") or "").strip(), (body.get("text") or "").strip()
    if not name or not text:
        raise HTTPException(400, "Template precisa de nome e texto")
    if len(text) > 4096:
        raise HTTPException(400, "Texto acima de 4096 caracteres (limite do Telegram)")
    doc = {"workspace_id": user["workspace_id"], "name": name, "text": text,
           "created_by": user["_id"], "created_at": datetime.now(timezone.utc)}
    doc["_id"] = str((await db.message_templates.insert_one(doc)).inserted_id)
    return doc


@router.delete("/disparos/templates/{template_id}")
async def delete_template(template_id: str, request: Request):
    user = await get_current_user(request)
    if not ObjectId.is_valid(template_id):
        raise HTTPException(404, "Template não encontrado")
    result = await db.message_templates.delete_one({"_id": ObjectId(template_id), "workspace_id": user["workspace_id"]})
    if not result.deleted_count:
        raise HTTPException(404, "Template não encontrado")
    return {"detail": "Removido"}


# ── Disparos: supressão ──
@router.get("/disparos/suppressions")
async def list_suppressions(request: Request, contact: str = None, limit: int = 100):
    user = await get_current_user(request)
    query = {"workspace_id": user["workspace_id"]}
    if contact:
        query["contact"] = contact.strip()
    items = await db.suppressions.find(query).sort("created_at", -1).limit(min(limit, 500)).to_list(min(limit, 500))
    for s_ in items:
        s_["_id"] = str(s_["_id"])
    return {"items": items, "total": await db.suppressions.count_documents(query)}


@router.post("/disparos/suppressions")
async def add_suppression(request: Request):
    user = await get_current_user(request)
    body = await _body(request)
    contact, provider = str(body.get("contact") or "").strip(), (body.get("provider") or "").strip()
    if not contact or provider not in ("telegram", "whatsapp"):
        raise HTTPException(400, "Informe o contato e o canal (telegram ou whatsapp)")
    now = datetime.now(timezone.utc)
    await db.suppressions.update_one(
        {"workspace_id": user["workspace_id"], "provider": provider, "contact": contact},
        {"$setOnInsert": {"reason": (body.get("reason") or "manual").strip(), "created_by": user["_id"], "created_at": now}},
        upsert=True,
    )
    await audit(user, "suppression.add", contact, "suppression")
    return {"detail": "Contato suprimido"}


@router.delete("/disparos/suppressions/{suppression_id}")
async def remove_suppression(suppression_id: str, request: Request):
    user = await get_current_user(request)
    if not ObjectId.is_valid(suppression_id):
        raise HTTPException(404, "Registro não encontrado")
    result = await db.suppressions.delete_one({"_id": ObjectId(suppression_id), "workspace_id": user["workspace_id"]})
    if not result.deleted_count:
        raise HTTPException(404, "Registro não encontrado")
    await audit(user, "suppression.remove", suppression_id, "suppression")
    return {"detail": "Removido da supressão"}


# ── Disparos ──
async def _dispatch_or_404(dispatch_id, ws_id):
    if not ObjectId.is_valid(dispatch_id):
        raise HTTPException(404, "Disparo não encontrado")
    doc = await db.dispatches.find_one({"_id": ObjectId(dispatch_id), "workspace_id": ws_id})
    if not doc:
        raise HTTPException(404, "Disparo não encontrado")
    return doc


async def _channel_or_400(channel_id, ws_id):
    if not ObjectId.is_valid(str(channel_id or "")):
        raise HTTPException(400, "Escolha o canal (conexão de Telegram ou WhatsApp)")
    integration = await db.integrations.find_one({"_id": ObjectId(channel_id), "workspace_id": ws_id,
                                                  "provider": {"$in": ["telegram", "whatsapp"]}})
    if not integration:
        raise HTTPException(400, "Canal inválido")
    return integration


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
    await _channel_or_400(body.channel, user["workspace_id"])
    if body.segment_id:
        await _segment_or_404(body.segment_id, user["workspace_id"])
    probe = {"content": body.content}
    if not variants_of(probe):
        raise HTTPException(400, "Escreva a mensagem (ou ao menos uma variante com peso)")
    scheduled_at = None
    if body.scheduled_at:
        try:
            scheduled_at = datetime.fromisoformat(body.scheduled_at.replace("Z", "+00:00"))
        except ValueError:
            raise HTTPException(400, "Data de agendamento inválida")
        if scheduled_at.tzinfo is None:
            raise HTTPException(400, "Agendamento precisa de fuso horário")
    now = datetime.now(timezone.utc)
    doc = {
        "workspace_id": user["workspace_id"],
        "name": body.name,
        "channel": body.channel,
        "segment_id": body.segment_id,
        "content": body.content,
        "scheduled_at": scheduled_at,
        "recurrence": body.recurrence,
        "status": "draft",
        "stats": {"target": 0, "eligible": 0, "sent": 0, "failed": 0},
        "created_at": now,
        "updated_at": now,
        "created_by": user["_id"],
    }
    result = await db.dispatches.insert_one(doc)
    doc["_id"] = str(result.inserted_id)
    await audit(user, "dispatch.create", doc["_id"], "dispatch")
    return doc


@router.post("/disparos/{dispatch_id}/preflight")
async def preflight_dispatch(dispatch_id: str, request: Request):
    """Contagem real antes de enviar: quem está no segmento, quem pode receber e por que não."""
    user = await get_current_user(request)
    dispatch = await _dispatch_or_404(dispatch_id, user["workspace_id"])
    integration = await _channel_or_400(dispatch.get("channel"), user["workspace_id"])
    try:
        total, eligible, skipped = await eligible_recipients(dispatch, integration)
    except SegmentError as exc:
        raise HTTPException(400, str(exc))
    variants = variants_of(dispatch)
    weight = sum(float(v.get("weight") or 0) for v in variants) or 1
    return {
        "channel": {"name": integration.get("name"), "provider": integration.get("provider")},
        "target": total, "eligible": len(eligible), "skipped": skipped,
        "variants": [{"name": v.get("name"), "share": round(float(v.get("weight") or 0) / weight * 100, 1),
                      "expected": round(len(eligible) * float(v.get("weight") or 0) / weight)} for v in variants],
        "sample": [{"name": p.get("name"), "contact_masked": c[:3] + "…" + c[-2:]} for p, c in eligible[:5]],
        "note": "WhatsApp só entrega texto livre dentro da janela de 24h da última mensagem do lead."
                if integration.get("provider") == "whatsapp" else None,
    }


@router.post("/disparos/{dispatch_id}/send")
async def send_dispatch(dispatch_id: str, request: Request):
    user = await get_current_user(request)
    dispatch = await _dispatch_or_404(dispatch_id, user["workspace_id"])
    if dispatch["status"] not in ("draft", "failed"):
        raise HTTPException(400, f"Disparo já está {dispatch['status']}")
    ws_id = user["workspace_id"]
    if await is_killed(ws_id, "dispatches"):
        raise HTTPException(423, "Disparos estão bloqueados em Governança")
    policy = await active_policy(ws_id, "dispatch_approval")
    if policy and not dispatch.get("approved_by"):
        integration = await _channel_or_400(dispatch.get("channel"), ws_id)
        try:
            _, eligible, _ = await eligible_recipients(dispatch, integration)
        except SegmentError as exc:
            raise HTTPException(400, str(exc))
        if len(eligible) >= int(policy["config"]["min_recipients"]):
            from routes.prove_routes import create_approval_doc
            approval = await create_approval_doc(
                user, "dispatch_send", dispatch_id, "dispatch",
                {"name": dispatch.get("name"), "recipients": len(eligible), "policy": policy["name"]},
                f"{len(eligible)} destinatários — política '{policy['name']}' exige aprovação a partir de {policy['config']['min_recipients']}")
            await db.dispatches.update_one({"_id": dispatch["_id"]}, {"$set": {
                "status": "awaiting_approval", "approval_id": approval["_id"], "updated_at": datetime.now(timezone.utc)}})
            await audit(user, "dispatch.awaiting_approval", dispatch_id, "dispatch")
            return {"status": "awaiting_approval", "approval_id": approval["_id"]}
    scheduled = dispatch.get("scheduled_at")
    status = "scheduled" if scheduled and scheduled > datetime.now(timezone.utc) else "queued"
    await db.dispatches.update_one({"_id": dispatch["_id"]}, {"$set": {
        "status": status, "approved_by": user["_id"], "updated_at": datetime.now(timezone.utc)}})
    await audit(user, f"dispatch.{status}", dispatch_id, "dispatch")
    return {"status": status}


@router.post("/disparos/{dispatch_id}/cancel")
async def cancel_dispatch(dispatch_id: str, request: Request):
    user = await get_current_user(request)
    dispatch = await _dispatch_or_404(dispatch_id, user["workspace_id"])
    if dispatch["status"] not in ("scheduled", "queued", "sending"):
        raise HTTPException(400, "Só dá para cancelar disparo agendado ou em envio")
    await db.dispatches.update_one({"_id": dispatch["_id"]}, {"$set": {"status": "cancelled", "updated_at": datetime.now(timezone.utc)}})
    cancelled = await db.dispatch_recipients.update_many({"dispatch_id": dispatch_id, "status": "queued"},
                                                         {"$set": {"status": "cancelled"}})
    await audit(user, "dispatch.cancel", dispatch_id, "dispatch")
    return {"detail": "Disparo cancelado", "not_sent": cancelled.modified_count}


@router.get("/disparos/{dispatch_id}/report")
async def dispatch_report(dispatch_id: str, request: Request):
    user = await get_current_user(request)
    dispatch = await _dispatch_or_404(dispatch_id, user["workspace_id"])
    rows = await db.dispatch_recipients.aggregate([
        {"$match": {"dispatch_id": dispatch_id}},
        {"$group": {"_id": {"variant": "$variant", "status": "$status"}, "n": {"$sum": 1}}},
    ]).to_list(200)
    by_variant = {}
    for r in rows:
        v = by_variant.setdefault(r["_id"]["variant"] or "—", {"variant": r["_id"]["variant"] or "—"})
        v[r["_id"]["status"]] = r["n"]
    # FTD depois do envio: quem recebeu e fez o primeiro depósito em até 7 dias.
    started = dispatch.get("started_at")
    ftds = {}
    if started:
        ids = [r["player_id"] async for r in db.dispatch_recipients.find({"dispatch_id": dispatch_id, "status": "sent"}, {"player_id": 1})]
        variants_by_player = {r["player_id"]: r.get("variant") async for r in db.dispatch_recipients.find(
            {"dispatch_id": dispatch_id, "status": "sent"}, {"player_id": 1, "variant": 1})}
        oids = [ObjectId(i) for i in ids if ObjectId.is_valid(i)]
        async for p in db.players.find({"_id": {"$in": oids}, "ftd_at": {"$gte": started, "$lte": started + timedelta(days=7)}}, {"_id": 1}):
            key = variants_by_player.get(str(p["_id"])) or "—"
            ftds[key] = ftds.get(key, 0) + 1
    for key, v in by_variant.items():
        v["ftds"] = ftds.get(key, 0)
        v["conversion"] = round(v["ftds"] / v["sent"] * 100, 1) if v.get("sent") else None
    failures = await db.dispatch_recipients.find({"dispatch_id": dispatch_id, "status": "failed"},
                                                 {"player_name": 1, "error": 1, "sent_at": 1}).limit(50).to_list(50)
    for f in failures:
        f["_id"] = str(f["_id"])
    dispatch["_id"] = str(dispatch["_id"])
    return {"dispatch": dispatch, "by_variant": list(by_variant.values()), "failures": failures}


@router.delete("/disparos/{dispatch_id}")
async def delete_dispatch(dispatch_id: str, request: Request):
    user = await get_current_user(request)
    dispatch = await _dispatch_or_404(dispatch_id, user["workspace_id"])
    if dispatch["status"] in ("queued", "sending"):
        raise HTTPException(400, "Cancele o disparo antes de remover")
    await db.dispatches.delete_one({"_id": dispatch["_id"]})
    await db.dispatch_recipients.delete_many({"dispatch_id": dispatch_id})
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
        query["name"] = {"$regex": re.escape(search), "$options": "i"}
    total = await db.campaigns.count_documents(query)
    items = await db.campaigns.find(query).sort("created_at", -1).skip((page - 1) * limit).limit(limit).to_list(limit)
    for item in items:
        item["_id"] = str(item["_id"])
    return {"items": items, "total": total, "page": page, "pages": math.ceil(total / limit) if total else 1}


@router.post("/media/sync")
async def sync_media(request: Request):
    """Puxa campanhas e investimento das contas de mídia conectadas."""
    user = await get_current_user(request)
    result = await sync_workspace(user["workspace_id"])
    if not result["synced"] and not result["errors"]:
        raise HTTPException(400, "Nenhuma conta do Meta Ads conectada em Integrações")
    if result["errors"] and not result["synced"]:
        # 400 e não 502: o proxy troca o corpo de 5xx por uma página HTML e a
        # mensagem do Meta nunca chegaria na tela.
        raise HTTPException(400, result["errors"][0]["error"])
    await audit(user, "media.sync", None, "campaign")
    return result


@router.get("/media/daily")
async def media_daily(request: Request, days: int = 30):
    """Investimento por dia, que é o que faltava para o CPFTD e o ROI diários."""
    user = await get_current_user(request)
    since = (datetime.now(timezone.utc) - timedelta(days=max(1, min(days, 180)))).strftime("%Y-%m-%d")
    rows = await db.campaign_daily.aggregate([
        {"$match": {"workspace_id": user["workspace_id"], "date": {"$gte": since}}},
        {"$group": {"_id": "$date", "spend": {"$sum": "$spend"}, "clicks": {"$sum": "$clicks"},
                    "impressions": {"$sum": "$impressions"}}},
        {"$sort": {"_id": 1}},
    ]).to_list(200)
    return {"items": [{"date": r["_id"], "spend": round(r["spend"], 2), "clicks": r["clicks"],
                       "impressions": r["impressions"]} for r in rows]}


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
