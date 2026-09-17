"""Agente de IA do atendimento: regras puras + execução.

As regras (quando responder, quando calar, quando passar para humano) são puras
para poder testar sem banco; a execução fica nas funções async no fim.
"""
import asyncio
import logging
import re
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional

from bson import ObjectId

logger = logging.getLogger(__name__)

MODELS = {
    "claude-haiku-4-5-20251001": ("anthropic", "Haiku 4.5 — rápido e econômico"),
    "claude-sonnet-5": ("anthropic", "Sonnet 5 — equilibrado"),
    "gpt-5.4-mini": ("openai", "GPT-5.4 mini — rápido"),
}
TONES = {
    "amigavel": "cordial e próximo",
    "profissional": "formal e direto",
    "consultivo": "consultivo, faz perguntas",
    "objetivo": "curto e objetivo",
}
MODES = {"suggested": "Operador revisa e aprova antes de enviar", "automatic": "IA envia direto para o cliente"}
AUDIENCES = {"external": "Cliente externo", "internal": "Equipe interna"}
OUTSIDE_HOURS = {"ai": "IA assume fora do horário humano", "silent": "IA fica em silêncio"}
ON_FAIL = {"human": "Transferir para humano", "silent": "Não responder"}
FOLLOWUP_TONES = {"leve": 'Leve — "tudo certo?"', "direto": "Direto — retoma a proposta", "urgente": "Urgente — última chamada"}
WEEKDAYS = ["seg", "ter", "qua", "qui", "sex", "sab", "dom"]

DEFAULT_PROMPT = (
    "Você é um atendente da operação falando com {{nome}}.\n\n"
    "Seja cordial, prestativo e responda de forma clara e objetiva.\n\n"
    "Comportamento:\n"
    "- Saudações breves\n"
    "- Respostas diretas, sem rodeios\n"
    "- Se a dúvida exigir decisão (preços, prazos, condições), transfira para humano"
)

MAX_HISTORY = 50


def agent_errors(data: Dict[str, Any]) -> List[str]:
    """Validação do formulário do agente."""
    errors = []
    if not str(data.get("name") or "").strip():
        errors.append("Dê um nome ao agente")
    if not str(data.get("prompt") or "").strip():
        errors.append("Escreva o prompt do agente")
    if data.get("mode") not in MODES:
        errors.append("Modo de resposta inválido")
    if data.get("model") not in MODELS:
        errors.append("Modelo de IA inválido")
    hours = data.get("hours") or {}
    if hours.get("enabled"):
        for key in ("start", "end"):
            if not re.fullmatch(r"([01]\d|2[0-3]):[0-5]\d", str(hours.get(key) or "")):
                errors.append("Horário precisa estar no formato HH:MM")
                break
        if not hours.get("days"):
            errors.append("Escolha ao menos um dia de atendimento")
    triggers = data.get("triggers") or {}
    if triggers.get("keywords_enabled") and not (triggers.get("keywords") or []):
        errors.append("Informe ao menos uma palavra-chave ou desligue o gatilho")
    for step in data.get("followups") or []:
        if int(step.get("after_min") or 0) < 1:
            errors.append("Cada passo de follow-up precisa de um tempo em minutos")
            break
    return errors


def in_hours(local: datetime, hours: Dict[str, Any]) -> bool:
    """Está dentro do horário humano configurado?"""
    if not hours or not hours.get("enabled"):
        return True
    if WEEKDAYS[local.weekday()] not in (hours.get("days") or WEEKDAYS):
        return False
    start, end = str(hours.get("start", "09:00")), str(hours.get("end", "18:00"))
    now = local.strftime("%H:%M")
    return start <= now < end if start <= end else (now >= start or now < end)


def blocked(agent: Dict[str, Any], ctx: Dict[str, Any]) -> Optional[str]:
    """Motivo para a IA não atender, ou None."""
    filters = agent.get("filters") or {}
    if filters.get("skip_assigned") and ctx.get("assigned_to"):
        return "lead já tem operador"
    excluded = {t.lower() for t in filters.get("excluded_tags") or []}
    if excluded & {str(t).lower() for t in ctx.get("tags") or []}:
        return "lead tem tag excluída"
    channels = agent.get("channels") or []
    if channels and ctx.get("integration_id") not in channels:
        return "canal fora do agente"
    replies = ctx.get("replies_sent") or 0
    limit = int((agent.get("handoff") or {}).get("max_replies") or 0)
    if limit and replies >= limit:
        return "limite de respostas da conversa"
    return None


def trigger_reason(agent: Dict[str, Any], ctx: Dict[str, Any]) -> Optional[str]:
    """Por que a IA deve responder agora (ou None)."""
    triggers = agent.get("triggers") or {}
    hours = agent.get("hours") or {}
    text = str(ctx.get("text") or "").lower()
    inside = in_hours(ctx["local"], hours)
    if hours.get("enabled") and not inside and hours.get("outside", "ai") == "silent":
        return None
    if triggers.get("new_lead") and ctx.get("is_new_lead"):
        return "lead novo"
    words = [w.lower().strip() for w in triggers.get("keywords") or [] if str(w).strip()]
    if triggers.get("keywords_enabled") and words and any(w in text for w in words):
        return "palavra-chave"
    idle_hours = triggers.get("idle_hours")
    if triggers.get("idle_enabled") and idle_hours and (ctx.get("hours_since_human") or 0) >= float(idle_hours):
        return "lead sem resposta humana"
    silence = triggers.get("operator_silence_min")
    if triggers.get("silence_enabled") and silence and (ctx.get("minutes_since_operator") or 0) >= float(silence):
        return "operador em silêncio"
    if hours.get("enabled") and not inside and hours.get("outside", "ai") == "ai" and ctx.get("text"):
        return "fora do horário humano"
    return None


def handoff_reason(agent: Dict[str, Any], text: str) -> Optional[str]:
    words = [w.lower().strip() for w in (agent.get("handoff") or {}).get("keywords") or [] if str(w).strip()]
    low = (text or "").lower()
    return "pedido do cliente" if any(w in low for w in words) else None


def render(text: str, lead: Dict[str, Any]) -> str:
    """Troca {{nome}}, {{telefone}}, {{etapa}} e {{tags}} pelos dados do lead."""
    values = {
        "nome": lead.get("name") or "",
        "primeiro_nome": (lead.get("name") or "").split(" ")[0],
        "telefone": (lead.get("contact") or {}).get("phone") or lead.get("phone") or "",
        "etapa": lead.get("pipeline_stage") or "sem etapa",
        "tags": ", ".join(lead.get("tags") or []) or "nenhuma",
        "email": (lead.get("contact") or {}).get("email") or "",
    }
    return re.sub(r"\{\{\s*(\w+)\s*\}\}", lambda m: str(values.get(m.group(1), m.group(0))), text or "")


def followup_schedule(agent: Dict[str, Any], now: datetime) -> List[Dict[str, Any]]:
    """Datas de cada reabordagem, contadas a partir de agora e acumuladas."""
    out, elapsed = [], 0
    for index, step in enumerate(agent.get("followups") or []):
        elapsed += int(step.get("after_min") or 0)
        out.append({"step": index + 1, "at": now + timedelta(minutes=elapsed), "tone": step.get("tone") or "leve"})
    return out


def system_prompt(agent: Dict[str, Any], lead: Dict[str, Any], brain: Dict[str, Any], memory: str = "") -> str:
    """Prompt final: instruções do agente + cérebro do workspace + memória do lead."""
    parts = [render(agent.get("prompt") or DEFAULT_PROMPT, lead)]
    if agent.get("guidelines"):
        parts.append("Diretrizes: " + render(agent["guidelines"], lead))
    tone = TONES.get(agent.get("tone", "amigavel"), TONES["amigavel"])
    parts.append(f"Tom de voz: {tone}. Máximo de {int(agent.get('max_words') or 100)} palavras por resposta.")
    if brain.get("summary"):
        parts.append("O que a operação sabe hoje:\n" + brain["summary"])
    facts = [f"Nome: {lead.get('name') or '—'}", f"Etapa: {lead.get('pipeline_stage') or 'sem etapa'}",
             f"Origem: {lead.get('origin') or lead.get('source') or '—'}"]
    if lead.get("has_ftd"):
        facts.append("Já fez o primeiro depósito")
    parts.append("Sobre este lead: " + " · ".join(facts))
    if memory:
        parts.append("Histórico resumido deste lead: " + memory)
    return "\n\n".join(parts)


# ── Execução ──
def _db():
    from database import db
    return db


async def _config_for(agent):
    from routes.copilot_routes import get_ai_config
    routing = (await _db().platform_settings.find_one({"key": "ai_routing"}) or {}).get("value") or {}
    model = agent.get("model") or (routing.get("agent") or {}).get("model") or "claude-haiku-4-5-20251001"
    provider = MODELS.get(model, ("openai", ""))[0]
    saved = await _db().ai_providers.find_one({"provider": provider, "status": "active"}, sort=[("created_at", -1)])
    if saved:
        return {"provider": provider, "model": model, "api_key": saved["api_key"]}
    # Sem provedor do mesmo fabricante: usa o que estiver configurado na plataforma.
    return await get_ai_config()


async def platform_guardrails():
    doc = await _db().platform_settings.find_one({"key": "ai_guardrails"})
    return (doc or {}).get("value") or {}


async def generate(agent, conversation, lead, history, incoming) -> str:
    guardrails = await platform_guardrails()
    cap = int(guardrails.get("monthly_token_cap") or 0)
    if cap:
        from admin_logic import estimate_tokens, month_range
        start, end, _ = month_range(None)
        spent = 0
        async for run in _db().ai_agent_runs.find({"created_at": {"$gte": start, "$lt": end}}, {"incoming": 1, "reply": 1}):
            spent += estimate_tokens(run.get("incoming", "")) + estimate_tokens(run.get("reply", ""))
        if spent >= cap:
            raise RuntimeError("limite mensal de IA da plataforma atingido")
    if guardrails.get("max_reply_words"):
        agent = {**agent, "max_words": min(int(agent.get("max_words") or 100), int(guardrails["max_reply_words"]))}
    config = await _config_for(agent)
    if not config:
        raise RuntimeError("nenhum provedor de IA configurado")
    from emergentintegrations.llm.chat import LlmChat, UserMessage
    brain = await get_brain(conversation["workspace_id"])
    memory = await lead_memory(conversation["workspace_id"], conversation.get("player_id"))
    chat = LlmChat(api_key=config["api_key"], session_id=f"agent_{agent['_id']}_{conversation['_id']}",
                   system_message=system_prompt(agent, lead, brain, memory)).with_model(config["provider"], config["model"])
    lines = [f"{'Cliente' if m.get('direction') == 'inbound' else 'Atendimento'}: {m.get('content')}" for m in history]
    lines.append(f"Cliente: {incoming}")
    reply = ((await chat.send_message(UserMessage(text="\n".join(lines[-MAX_HISTORY:])))) or "").strip()
    blocked = [t for t in guardrails.get("blocked_terms") or [] if t and t.lower() in reply.lower()]
    if blocked:
        # Termo proibido pela plataforma: melhor passar para humano do que enviar.
        raise RuntimeError(f"resposta bloqueada pelo guardrail: {', '.join(blocked)}")
    return reply


async def _context(agent, conversation, player, text, now):
    window = int(agent.get("memory_messages") or 30)
    history = await _db().messages.find({"conversation_id": str(conversation["_id"])}).sort("created_at", -1).limit(window).to_list(window)
    history.reverse()
    human = [m for m in history if m.get("direction") == "outbound" and not str(m.get("sender_id", "")).startswith("system:")]
    inbound = [m for m in history if m.get("direction") == "inbound"]
    last_human = human[-1]["created_at"] if human else None
    return {
        "text": text,
        "is_new_lead": len(inbound) <= 1,
        "assigned_to": conversation.get("assigned_to"),
        "tags": list(conversation.get("tags") or []) + list(player.get("tags") or []),
        "integration_id": conversation.get("integration_id"),
        "replies_sent": len([m for m in history if m.get("type") == "ai_agent"]),
        "hours_since_human": (now - last_human).total_seconds() / 3600 if last_human else 10_000,
        "minutes_since_operator": (now - last_human).total_seconds() / 60 if last_human else 10_000,
        "local": now.astimezone(await _tz(conversation["workspace_id"])),
    }, history


async def _tz(workspace_id):
    from analytics import workspace_tz
    ws = await _db().workspaces.find_one({"_id": ObjectId(workspace_id)}, {"timezone": 1}) if ObjectId.is_valid(str(workspace_id)) else None
    return workspace_tz((ws or {}).get("timezone"))


async def active_agent(workspace_id):
    return await _db().ai_agents.find_one({"workspace_id": workspace_id, "status": "active"}, sort=[("updated_at", -1)])


async def _record(conversation, agent, text, mode):
    """Grava a resposta: sugerida fica visível só para a equipe."""
    from realtime import inbox_events
    now = datetime.now(timezone.utc)
    doc = {
        "conversation_id": str(conversation["_id"]), "workspace_id": conversation["workspace_id"],
        "sender_id": f"system:ai:{agent['_id']}", "sender_name": agent.get("name") or "Agente IA",
        "content": text, "type": "ai_agent", "agent_id": str(agent["_id"]),
        "direction": "outbound" if mode == "automatic" else "internal",
        "suggestion": mode != "automatic", "created_at": now,
    }
    result = await _db().messages.insert_one(doc)
    await _db().conversations.update_one({"_id": conversation["_id"]}, {"$set": {
        "updated_at": now, **({"last_message": text[:100]} if mode == "automatic" else {})}})
    await inbox_events.publish(conversation["workspace_id"], {
        "type": "ai.reply", "conversation_id": str(conversation["_id"]), "message_id": str(result.inserted_id)})
    return str(result.inserted_id)


async def _handoff(agent, conversation, lead):
    from messaging import notify, send_channel_message
    message = (agent.get("handoff") or {}).get("message")
    if message:
        rendered = render(message, lead)
        try:
            await send_channel_message(conversation, rendered)
        except Exception as exc:  # noqa: BLE001 — a transferência acontece mesmo se o envio falhar
            logger.warning("handoff sem envio: %s", exc)
        await _record(conversation, agent, rendered, "automatic")
    await _db().conversations.update_one({"_id": conversation["_id"]}, {"$set": {"status": "queue", "ai_handoff": True}})
    await notify(conversation["workspace_id"], "ai_handoff", "Agente de IA pediu ajuda humana",
                 f"{conversation.get('player_name') or 'Lead'} precisa de atendimento.",
                 link=f"/inbox/{conversation['_id']}", dedupe_key=f"handoff:{conversation['_id']}")


async def on_incoming(conversation, player, text, *, is_followup=False):
    """Chamado a cada mensagem recebida. Devolve o que a IA fez (ou None)."""
    ws_id = conversation["workspace_id"]
    from database import is_killed
    agent = await active_agent(ws_id)
    if not agent or await is_killed(ws_id, "ai"):
        return None
    now = datetime.now(timezone.utc)
    ctx, history = await _context(agent, conversation, player, text, now)
    reason = blocked(agent, ctx)
    if reason:
        return None
    if handoff_reason(agent, text):
        await _handoff(agent, conversation, player)
        return {"action": "handoff"}
    why = trigger_reason(agent, ctx) if not is_followup else "follow-up"
    if not why:
        return None
    mode = agent.get("mode", "suggested")
    try:
        reply = await generate(agent, conversation, player, history, text)
    except Exception as exc:  # noqa: BLE001
        logger.warning("agente de IA falhou: %s", exc)
        if (agent.get("handoff") or {}).get("on_fail", "human") == "human":
            await _handoff(agent, conversation, player)
        await _db().ai_agent_runs.insert_one({"workspace_id": ws_id, "agent_id": str(agent["_id"]),
                                           "conversation_id": str(conversation["_id"]), "error": str(exc)[:200],
                                           "trigger": why, "created_at": now})
        return {"action": "failed"}
    if mode == "automatic":
        from messaging import send_channel_message
        await send_channel_message(conversation, reply)
    await _record(conversation, agent, reply, mode)
    await _db().ai_agent_runs.insert_one({
        "workspace_id": ws_id, "agent_id": str(agent["_id"]), "conversation_id": str(conversation["_id"]),
        "player_name": conversation.get("player_name"), "trigger": why, "mode": mode,
        "incoming": text[:300], "reply": reply[:1000], "created_at": now})
    await _schedule_followups(agent, conversation, now)
    await remember(ws_id, conversation.get("player_id"), text, reply)
    return {"action": mode, "reply": reply}


async def _schedule_followups(agent, conversation, now):
    await _db().ai_followups.delete_many({"conversation_id": str(conversation["_id"]), "status": "pending"})
    steps = followup_schedule(agent, now) if (agent.get("followup_enabled") and agent.get("followups")) else []
    if steps:
        await _db().ai_followups.insert_many([{
            "workspace_id": conversation["workspace_id"], "agent_id": str(agent["_id"]),
            "conversation_id": str(conversation["_id"]), "run_at": step["at"], "tone": step["tone"],
            "step": step["step"], "status": "pending", "created_at": now} for step in steps])


async def run_followups():
    """Reabordagens vencidas: canceladas se o lead respondeu ou um humano assumiu."""
    now = datetime.now(timezone.utc)
    async for job in _db().ai_followups.find({"status": "pending", "run_at": {"$lte": now}}).limit(50):
        await _db().ai_followups.update_one({"_id": job["_id"]}, {"$set": {"status": "done", "done_at": now}})
        conversation = await _db().conversations.find_one({"_id": ObjectId(job["conversation_id"])})
        if not conversation or conversation.get("status") == "resolved" or conversation.get("assigned_to"):
            continue
        last = await _db().messages.find_one({"conversation_id": job["conversation_id"]}, sort=[("created_at", -1)])
        if last and last.get("direction") == "inbound":
            continue  # o lead respondeu: follow-up perde o sentido
        player = await _db().players.find_one({"_id": ObjectId(conversation["player_id"])}) if ObjectId.is_valid(str(conversation.get("player_id"))) else {}
        prompt = {"leve": "Faça uma reabordagem leve perguntando se está tudo certo.",
                  "direto": "Retome a conversa lembrando da proposta e pergunte se pode seguir.",
                  "urgente": "Faça uma última chamada, avisando que vai encerrar o atendimento."}.get(job.get("tone"), "")
        await on_incoming(conversation, player or {}, prompt, is_followup=True)


async def worker_loop(interval_seconds: int = 60):
    while True:
        try:
            await run_followups()
        except Exception as exc:  # noqa: BLE001 — o laço não morre
            logger.error("follow-ups da IA: %s", exc)
        await asyncio.sleep(interval_seconds)


# ── Cérebro do workspace ──
STOPWORDS = set("""a o e de da do das dos para por com sem que se não sim uma um uns umas na no nas nos meu minha
eu voce você tu ele ela isso isto aqui ali quando como qual quais onde porque pois mas ja já tem ter estou esta está
ok obrigado obrigada bom boa dia tarde noite oi ola olá quero queria pode posso vou vai fazer sobre mais menos""".split())


def top_words(texts: List[str], limit: int = 12) -> List[Dict[str, Any]]:
    counts: Dict[str, int] = {}
    for text in texts:
        for word in re.findall(r"[a-zà-ú]{4,}", str(text or "").lower()):
            if word not in STOPWORDS:
                counts[word] = counts.get(word, 0) + 1
    return [{"term": w, "count": c} for w, c in sorted(counts.items(), key=lambda kv: -kv[1])[:limit]]


async def consolidate_brain(workspace_id: str) -> Dict[str, Any]:
    """Resumo do que a operação sabe: volume, fontes, assuntos e etiquetas."""
    now = datetime.now(timezone.utc)
    since = now - timedelta(days=30)
    players = await _db().players.count_documents({"workspace_id": workspace_id})
    ftds = await _db().players.count_documents({"workspace_id": workspace_id, "has_ftd": True})
    open_convs = await _db().conversations.count_documents({"workspace_id": workspace_id, "status": {"$ne": "resolved"}})
    sources = await _db().players.aggregate([
        {"$match": {"workspace_id": workspace_id}},
        {"$group": {"_id": {"$ifNull": ["$source", "$origin"]}, "n": {"$sum": 1}}},
        {"$sort": {"n": -1}}, {"$limit": 6},
    ]).to_list(6)
    tags = await _db().conversations.aggregate([
        {"$match": {"workspace_id": workspace_id}}, {"$unwind": "$tags"},
        {"$group": {"_id": "$tags", "n": {"$sum": 1}}}, {"$sort": {"n": -1}}, {"$limit": 8},
    ]).to_list(8)
    reasons = await _db().conversations.aggregate([
        {"$match": {"workspace_id": workspace_id, "status": "resolved"}},
        {"$group": {"_id": "$close_reason", "n": {"$sum": 1}}}, {"$sort": {"n": -1}}, {"$limit": 5},
    ]).to_list(5)
    texts = [m["content"] async for m in _db().messages.find(
        {"workspace_id": workspace_id, "direction": "inbound", "created_at": {"$gte": since}}, {"content": 1}).limit(800)]
    subjects = top_words(texts)
    notes = [n["text"] for n in await _db().brain_notes.find({"workspace_id": workspace_id}).sort("created_at", -1).to_list(20)]
    lines = [
        f"{players} leads no total, {ftds} com primeiro depósito, {open_convs} conversas abertas.",
        "Fontes que mais trazem lead: " + (", ".join(f"{s['_id'] or 'sem origem'} ({s['n']})" for s in sources) or "sem dados"),
        "Assuntos mais citados pelos leads: " + (", ".join(s["term"] for s in subjects) or "sem dados"),
    ]
    if tags:
        lines.append("Etiquetas mais usadas: " + ", ".join(f"{t['_id']} ({t['n']})" for t in tags))
    if reasons:
        lines.append("Motivos de encerramento: " + ", ".join(f"{r['_id'] or 'sem motivo'} ({r['n']})" for r in reasons))
    lines += [f"Aprendizado registrado: {n}" for n in notes]
    doc = {
        "workspace_id": workspace_id, "players": players, "ftds": ftds, "open_conversations": open_convs,
        "sources": [{"source": s["_id"] or "sem origem", "count": s["n"]} for s in sources],
        "tags": [{"tag": t["_id"], "count": t["n"]} for t in tags], "subjects": subjects,
        "notes": notes, "summary": "\n".join(lines), "updated_at": now,
    }
    await _db().workspace_brain.update_one({"workspace_id": workspace_id}, {"$set": doc}, upsert=True)
    return doc


async def get_brain(workspace_id: str) -> Dict[str, Any]:
    brain = await _db().workspace_brain.find_one({"workspace_id": workspace_id})
    if not brain or (datetime.now(timezone.utc) - brain["updated_at"]) > timedelta(hours=6):
        brain = await consolidate_brain(workspace_id)
    brain.pop("_id", None)
    return brain


async def remember(workspace_id: str, player_id: Optional[str], incoming: str, reply: str) -> None:
    """Memória por lead: assuntos que ele trouxe e a última resposta dada."""
    if not player_id:
        return
    memory = await _db().lead_memories.find_one({"workspace_id": workspace_id, "player_id": player_id}) or {}
    texts = (memory.get("texts") or [])[-20:] + [incoming]
    await _db().lead_memories.update_one(
        {"workspace_id": workspace_id, "player_id": player_id},
        {"$set": {"texts": texts, "topics": [t["term"] for t in top_words(texts, 6)],
                  "last_reply": reply[:400], "updated_at": datetime.now(timezone.utc)}},
        upsert=True)


async def lead_memory(workspace_id: str, player_id: Optional[str]) -> str:
    if not player_id:
        return ""
    memory = await _db().lead_memories.find_one({"workspace_id": workspace_id, "player_id": player_id})
    if not memory:
        return ""
    parts = []
    if memory.get("topics"):
        parts.append("já falou sobre " + ", ".join(memory["topics"]))
    if memory.get("last_reply"):
        parts.append("última resposta dada: " + memory["last_reply"])
    return "; ".join(parts)
