"""Cadastros da workspace: etiquetas, respostas rápidas, aviso sonoro e agentes de IA."""
from fastapi import APIRouter, HTTPException, Request
from datetime import datetime, timezone
from bson import ObjectId
from database import db, audit
from auth import get_current_user
from ai_agent import (
    AUDIENCES, DEFAULT_PROMPT, FOLLOWUP_TONES, MODELS, MODES, ON_FAIL, OUTSIDE_HOURS, TONES, WEEKDAYS,
    agent_errors, consolidate_brain, generate, get_brain, render,
)

router = APIRouter(prefix="/api", tags=["workspace"])

TAG_COLORS = ["blue", "green", "amber", "orange", "sky", "violet", "pink", "slate"]
AUDIO_SOUNDS = {"chime": "Chime", "ping": "Ping", "alert": "Alerta", "pop": "Pop"}
AUDIO_DEFAULTS = {"enabled": True, "sound": "chime", "volume": 70, "min_interval_seconds": 8}
VARIABLES = ["nome", "primeiro_nome", "telefone", "email", "etapa", "tags"]


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


# ── Etiquetas ──
@router.get("/tags")
async def list_tags(request: Request):
    user = await get_current_user(request)
    items = await db.workspace_tags.find({"workspace_id": user["workspace_id"]}).sort("name", 1).to_list(200)
    for item in items:
        item["_id"] = str(item["_id"])
    return {"items": items, "colors": TAG_COLORS}


@router.post("/tags")
async def create_tag(request: Request):
    user = await get_current_user(request)
    body = await _body(request)
    name = (body.get("name") or "").strip()
    if not name:
        raise HTTPException(400, "Dê um nome à etiqueta")
    if await db.workspace_tags.find_one({"workspace_id": user["workspace_id"], "name": name}):
        raise HTTPException(400, "Já existe uma etiqueta com esse nome")
    doc = {"workspace_id": user["workspace_id"], "name": name,
           "color": body.get("color") if body.get("color") in TAG_COLORS else TAG_COLORS[0],
           "description": (body.get("description") or "").strip() or None,
           "created_at": datetime.now(timezone.utc)}
    doc["_id"] = str((await db.workspace_tags.insert_one(doc)).inserted_id)
    await audit(user, "tag.create", doc["_id"], "tag")
    return doc


@router.put("/tags/{tag_id}")
async def update_tag(tag_id: str, request: Request):
    user = await get_current_user(request)
    body = await _body(request)
    current = await db.workspace_tags.find_one({"_id": _oid(tag_id, "Etiqueta"), "workspace_id": user["workspace_id"]})
    if not current:
        raise HTTPException(404, "Etiqueta não encontrada")
    update = {"name": (body.get("name") or current["name"]).strip(),
              "color": body.get("color") if body.get("color") in TAG_COLORS else current.get("color"),
              "description": (body.get("description") or "").strip() or None}
    await db.workspace_tags.update_one({"_id": current["_id"]}, {"$set": update})
    if update["name"] != current["name"]:
        # Renomear vale para quem já usa a etiqueta.
        await db.conversations.update_many({"workspace_id": user["workspace_id"], "tags": current["name"]},
                                           {"$set": {"tags.$": update["name"]}})
        await db.players.update_many({"workspace_id": user["workspace_id"], "tags": current["name"]},
                                     {"$set": {"tags.$": update["name"]}})
    return {"detail": "Etiqueta atualizada"}


@router.delete("/tags/{tag_id}")
async def delete_tag(tag_id: str, request: Request):
    user = await get_current_user(request)
    tag = await db.workspace_tags.find_one({"_id": _oid(tag_id, "Etiqueta"), "workspace_id": user["workspace_id"]})
    if not tag:
        raise HTTPException(404, "Etiqueta não encontrada")
    await db.workspace_tags.delete_one({"_id": tag["_id"]})
    await db.conversations.update_many({"workspace_id": user["workspace_id"]}, {"$pull": {"tags": tag["name"]}})
    await db.players.update_many({"workspace_id": user["workspace_id"]}, {"$pull": {"tags": tag["name"]}})
    await audit(user, "tag.delete", tag_id, "tag")
    return {"detail": "Etiqueta removida"}


# ── Respostas rápidas ──
@router.get("/quick-replies")
async def list_quick_replies(request: Request):
    user = await get_current_user(request)
    items = await db.quick_replies.find({"workspace_id": user["workspace_id"]}).sort("shortcut", 1).to_list(200)
    for item in items:
        item["_id"] = str(item["_id"])
    return {"items": items, "variables": VARIABLES}


@router.post("/quick-replies")
async def create_quick_reply(request: Request):
    user = await get_current_user(request)
    body = await _body(request)
    title = (body.get("title") or "").strip()
    content = (body.get("content") or "").strip()
    if not title or not content:
        raise HTTPException(400, "Informe título e texto da resposta")
    shortcut = (body.get("shortcut") or "").strip().lstrip("/").lower() or None
    if shortcut and await db.quick_replies.find_one({"workspace_id": user["workspace_id"], "shortcut": shortcut}):
        raise HTTPException(400, "Já existe uma resposta com esse atalho")
    doc = {"workspace_id": user["workspace_id"], "title": title, "content": content, "shortcut": shortcut,
           "created_by": user["_id"], "created_at": datetime.now(timezone.utc)}
    doc["_id"] = str((await db.quick_replies.insert_one(doc)).inserted_id)
    await audit(user, "quick_reply.create", doc["_id"], "quick_reply")
    return doc


@router.put("/quick-replies/{reply_id}")
async def update_quick_reply(reply_id: str, request: Request):
    user = await get_current_user(request)
    body = await _body(request)
    current = await db.quick_replies.find_one({"_id": _oid(reply_id, "Resposta"), "workspace_id": user["workspace_id"]})
    if not current:
        raise HTTPException(404, "Resposta não encontrada")
    update = {"title": (body.get("title") or current["title"]).strip(),
              "content": (body.get("content") or current["content"]).strip(),
              "shortcut": (body.get("shortcut") or "").strip().lstrip("/").lower() or None}
    await db.quick_replies.update_one({"_id": current["_id"]}, {"$set": update})
    return {"detail": "Resposta atualizada"}


@router.delete("/quick-replies/{reply_id}")
async def delete_quick_reply(reply_id: str, request: Request):
    user = await get_current_user(request)
    result = await db.quick_replies.delete_one({"_id": _oid(reply_id, "Resposta"), "workspace_id": user["workspace_id"]})
    if not result.deleted_count:
        raise HTTPException(404, "Resposta não encontrada")
    return {"detail": "Resposta removida"}


# ── Aviso sonoro ──
@router.get("/settings/inbox-audio")
async def get_audio(request: Request):
    user = await get_current_user(request)
    saved = (await db.users.find_one({"_id": ObjectId(user["_id"])}, {"inbox_audio": 1}) or {}).get("inbox_audio") or {}
    return {**AUDIO_DEFAULTS, **saved, "sounds": AUDIO_SOUNDS}


@router.put("/settings/inbox-audio")
async def set_audio(request: Request):
    user = await get_current_user(request)
    body = await _body(request)
    try:
        settings = {
            "enabled": bool(body.get("enabled", True)),
            "sound": body.get("sound") if body.get("sound") in AUDIO_SOUNDS else AUDIO_DEFAULTS["sound"],
            "volume": max(0, min(100, int(body.get("volume", 70)))),
            "min_interval_seconds": max(0, min(300, int(body.get("min_interval_seconds", 8)))),
        }
    except (TypeError, ValueError):
        raise HTTPException(400, "Volume e intervalo precisam ser números")
    await db.users.update_one({"_id": ObjectId(user["_id"])}, {"$set": {"inbox_audio": settings}})
    return {**settings, "sounds": AUDIO_SOUNDS}


# ── Agentes de IA ──
@router.get("/ai-agents/meta/options")
async def agent_options(request: Request):
    user = await get_current_user(request)
    channels = await db.integrations.find({"workspace_id": user["workspace_id"], "category": "messaging"},
                                          {"name": 1, "provider": 1}).to_list(50)
    return {
        "models": [{"id": k, "label": v[1]} for k, v in MODELS.items()],
        "modes": MODES, "audiences": AUDIENCES, "tones": TONES, "outside_hours": OUTSIDE_HOURS,
        "on_fail": ON_FAIL, "followup_tones": FOLLOWUP_TONES, "weekdays": WEEKDAYS,
        "variables": VARIABLES, "default_prompt": DEFAULT_PROMPT,
        "channels": [{"id": str(c["_id"]), "name": c.get("name"), "provider": c.get("provider")} for c in channels],
        "tags": [t["name"] async for t in db.workspace_tags.find({"workspace_id": user["workspace_id"]}, {"name": 1})],
    }


def _agent_doc(body, user):
    return {
        "workspace_id": user["workspace_id"],
        "name": (body.get("name") or "").strip(),
        "description": (body.get("description") or "").strip() or None,
        "avatar": int(body.get("avatar") or 0) % 4,
        "mode": body.get("mode", "suggested"),
        "audience": body.get("audience") if body.get("audience") in AUDIENCES else "external",
        "model": body.get("model") or "claude-haiku-4-5-20251001",
        "channels": [str(c) for c in body.get("channels") or []],
        "humanize": {k: bool((body.get("humanize") or {}).get(k, True)) for k in ("typing", "delay", "wait_lead")},
        "prompt": (body.get("prompt") or "").strip(),
        "tone": body.get("tone") if body.get("tone") in TONES else "amigavel",
        "max_words": max(20, min(600, int(body.get("max_words") or 100))),
        "temperature": max(0.0, min(1.0, float(body.get("temperature") or 0.7))),
        "guidelines": (body.get("guidelines") or "").strip() or None,
        "memory_messages": max(5, min(100, int(body.get("memory_messages") or 30))),
        "hours": {
            "enabled": bool((body.get("hours") or {}).get("enabled")),
            "days": [d for d in (body.get("hours") or {}).get("days") or [] if d in WEEKDAYS],
            "start": (body.get("hours") or {}).get("start") or "09:00",
            "end": (body.get("hours") or {}).get("end") or "18:00",
            "outside": (body.get("hours") or {}).get("outside") if (body.get("hours") or {}).get("outside") in OUTSIDE_HOURS else "ai",
        },
        "triggers": {
            "new_lead": bool((body.get("triggers") or {}).get("new_lead", True)),
            "keywords_enabled": bool((body.get("triggers") or {}).get("keywords_enabled")),
            "keywords": [str(k).strip() for k in (body.get("triggers") or {}).get("keywords") or [] if str(k).strip()],
            "idle_enabled": bool((body.get("triggers") or {}).get("idle_enabled")),
            "idle_hours": float((body.get("triggers") or {}).get("idle_hours") or 24),
            "silence_enabled": bool((body.get("triggers") or {}).get("silence_enabled")),
            "operator_silence_min": float((body.get("triggers") or {}).get("operator_silence_min") or 30),
        },
        "filters": {
            "skip_assigned": bool((body.get("filters") or {}).get("skip_assigned", True)),
            "excluded_tags": [str(t) for t in (body.get("filters") or {}).get("excluded_tags") or []],
        },
        "followup_enabled": bool(body.get("followup_enabled")),
        "followups": [{"after_min": int(s.get("after_min") or 0), "tone": s.get("tone") or "leve"}
                      for s in body.get("followups") or []],
        "handoff": {
            "keywords": [str(k).strip() for k in (body.get("handoff") or {}).get("keywords") or [] if str(k).strip()],
            "max_replies": int((body.get("handoff") or {}).get("max_replies") or 0),
            "on_fail": (body.get("handoff") or {}).get("on_fail") if (body.get("handoff") or {}).get("on_fail") in ON_FAIL else "human",
            "message": ((body.get("handoff") or {}).get("message") or "").strip() or None,
        },
        "status": "active" if body.get("status") == "active" else "inactive",
    }


@router.get("/ai-agents")
async def list_agents(request: Request):
    user = await get_current_user(request)
    items = await db.ai_agents.find({"workspace_id": user["workspace_id"]}).sort("created_at", -1).to_list(50)
    for item in items:
        item["_id"] = str(item["_id"])
    return {"items": items}


@router.post("/ai-agents")
async def create_agent(request: Request):
    user = await get_current_user(request)
    body = await _body(request)
    doc = _agent_doc(body, user)
    errors = agent_errors(doc)
    if errors:
        raise HTTPException(400, "; ".join(errors))
    now = datetime.now(timezone.utc)
    doc.update({"created_at": now, "updated_at": now, "created_by": user["_id"]})
    doc["_id"] = str((await db.ai_agents.insert_one(doc)).inserted_id)
    await audit(user, "ai_agent.create", doc["_id"], "ai_agent")
    return doc


async def _agent_or_404(agent_id, ws_id):
    agent = await db.ai_agents.find_one({"_id": _oid(agent_id, "Agente"), "workspace_id": ws_id})
    if not agent:
        raise HTTPException(404, "Agente não encontrado")
    return agent


@router.get("/ai-agents/{agent_id}")
async def get_agent(agent_id: str, request: Request):
    user = await get_current_user(request)
    agent = await _agent_or_404(agent_id, user["workspace_id"])
    agent["_id"] = str(agent["_id"])
    return agent


@router.put("/ai-agents/{agent_id}")
async def update_agent(agent_id: str, request: Request):
    user = await get_current_user(request)
    agent = await _agent_or_404(agent_id, user["workspace_id"])
    body = await _body(request)
    if set(body) <= {"status"}:  # ligar/desligar pelo card
        status = "active" if body.get("status") == "active" else "inactive"
        if status == "active":
            # Um agente ativo por vez: dois responderiam a mesma conversa.
            await db.ai_agents.update_many({"workspace_id": user["workspace_id"], "_id": {"$ne": agent["_id"]}},
                                           {"$set": {"status": "inactive"}})
        await db.ai_agents.update_one({"_id": agent["_id"]}, {"$set": {"status": status, "updated_at": datetime.now(timezone.utc)}})
        return {"status": status}
    doc = _agent_doc({**agent, **body}, user)
    errors = agent_errors(doc)
    if errors:
        raise HTTPException(400, "; ".join(errors))
    doc["updated_at"] = datetime.now(timezone.utc)
    if doc["status"] == "active":
        await db.ai_agents.update_many({"workspace_id": user["workspace_id"], "_id": {"$ne": agent["_id"]}},
                                       {"$set": {"status": "inactive"}})
    await db.ai_agents.update_one({"_id": agent["_id"]}, {"$set": doc})
    await audit(user, "ai_agent.update", agent_id, "ai_agent")
    return {"detail": "Agente atualizado"}


@router.delete("/ai-agents/{agent_id}")
async def delete_agent(agent_id: str, request: Request):
    user = await get_current_user(request)
    agent = await _agent_or_404(agent_id, user["workspace_id"])
    await db.ai_agents.delete_one({"_id": agent["_id"]})
    await db.ai_followups.delete_many({"agent_id": agent_id})
    await audit(user, "ai_agent.delete", agent_id, "ai_agent")
    return {"detail": "Agente removido"}


@router.post("/ai-agents/{agent_id}/test")
async def test_agent(agent_id: str, request: Request):
    """Conversa de teste: não envia nada para o cliente."""
    user = await get_current_user(request)
    agent = await _agent_or_404(agent_id, user["workspace_id"])
    body = await _body(request)
    message = (body.get("message") or "").strip()
    if not message:
        raise HTTPException(400, "Escreva a mensagem do cliente")
    lead = {"name": body.get("lead_name") or "Cliente Teste", "pipeline_stage": "Novo lead", "tags": []}
    history = [{"direction": "inbound" if h.get("role") == "user" else "outbound", "content": h.get("content")}
               for h in body.get("history") or []]
    conversation = {"_id": f"test-{agent_id}", "workspace_id": user["workspace_id"], "player_id": None}
    try:
        reply = await generate(agent, conversation, lead, history, message)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(503, f"Não deu para gerar a resposta: {exc}")
    return {"reply": reply, "mode": agent.get("mode")}


@router.get("/ai-agents/{agent_id}/runs")
async def agent_runs(agent_id: str, request: Request, limit: int = 50):
    user = await get_current_user(request)
    await _agent_or_404(agent_id, user["workspace_id"])
    items = await db.ai_agent_runs.find({"workspace_id": user["workspace_id"], "agent_id": agent_id}) \
        .sort("created_at", -1).limit(limit).to_list(limit)
    for item in items:
        item["_id"] = str(item["_id"])
    return {"items": items}


# ── Cérebro ──
@router.get("/ai-brain")
async def read_brain(request: Request):
    user = await get_current_user(request)
    brain = await get_brain(user["workspace_id"])
    notes = await db.brain_notes.find({"workspace_id": user["workspace_id"]}).sort("created_at", -1).to_list(50)
    for note in notes:
        note["_id"] = str(note["_id"])
    return {**brain, "notes_detail": notes}


@router.post("/ai-brain/refresh")
async def refresh_brain(request: Request):
    user = await get_current_user(request)
    return await consolidate_brain(user["workspace_id"])


@router.post("/ai-brain/notes")
async def add_note(request: Request):
    user = await get_current_user(request)
    body = await _body(request)
    text = (body.get("text") or "").strip()
    if len(text) < 5:
        raise HTTPException(400, "Escreva o que o agente precisa saber")
    doc = {"workspace_id": user["workspace_id"], "text": text, "created_by": user["_id"],
           "created_by_name": user.get("name", ""), "created_at": datetime.now(timezone.utc)}
    doc["_id"] = str((await db.brain_notes.insert_one(doc)).inserted_id)
    await consolidate_brain(user["workspace_id"])
    return doc


@router.delete("/ai-brain/notes/{note_id}")
async def delete_note(note_id: str, request: Request):
    user = await get_current_user(request)
    result = await db.brain_notes.delete_one({"_id": _oid(note_id, "Aprendizado"), "workspace_id": user["workspace_id"]})
    if not result.deleted_count:
        raise HTTPException(404, "Aprendizado não encontrado")
    await consolidate_brain(user["workspace_id"])
    return {"detail": "Removido"}


@router.post("/quick-replies/{reply_id}/render")
async def render_quick_reply(reply_id: str, request: Request):
    """Texto já com as variáveis trocadas pelos dados do lead da conversa."""
    user = await get_current_user(request)
    reply = await db.quick_replies.find_one({"_id": _oid(reply_id, "Resposta"), "workspace_id": user["workspace_id"]})
    if not reply:
        raise HTTPException(404, "Resposta não encontrada")
    body = await _body(request)
    lead = {}
    conversation_id = body.get("conversation_id")
    if conversation_id and ObjectId.is_valid(str(conversation_id)):
        conversation = await db.conversations.find_one({"_id": ObjectId(conversation_id), "workspace_id": user["workspace_id"]})
        if conversation and ObjectId.is_valid(str(conversation.get("player_id"))):
            lead = await db.players.find_one({"_id": ObjectId(conversation["player_id"])}) or {}
            lead["pipeline_stage"] = conversation.get("pipeline_stage") or lead.get("pipeline_stage")
    return {"content": render(reply["content"], lead)}
