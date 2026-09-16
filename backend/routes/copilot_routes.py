from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import StreamingResponse
from datetime import datetime, timezone
from database import db
from auth import get_current_user
from models import CopilotMessage
import os
import json
import logging

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api", tags=["copilot"])


async def get_ai_config():
    """Get AI provider config - first from DB, then fallback to env"""
    provider = await db.ai_providers.find_one({"status": "active"}, sort=[("created_at", -1)])
    if provider:
        return {
            "provider": provider["provider"],
            "model": provider["model"],
            "api_key": provider["api_key"],
        }
    # Fallback to env
    key = os.environ.get("EMERGENT_LLM_KEY")
    if key:
        return {"provider": "openai", "model": "gpt-5.4-mini", "api_key": key}
    return None


@router.post("/copilot/chat")
async def copilot_chat(body: CopilotMessage, request: Request):
    user = await get_current_user(request)
    config = await get_ai_config()
    if not config:
        raise HTTPException(503, "Nenhum provedor de IA configurado. Configure em Plataforma > IA.")

    # Save message to history
    now = datetime.now(timezone.utc)
    await db.copilot_messages.insert_one({
        "workspace_id": user.get("workspace_id"),
        "user_id": user["_id"],
        "role": "user",
        "content": body.message,
        "created_at": now,
    })

    try:
        from emergentintegrations.llm.chat import LlmChat, UserMessage, TextDelta, StreamDone

        workspace = None
        if user.get("workspace_id"):
            from bson import ObjectId
            workspace = await db.workspaces.find_one({"_id": ObjectId(user["workspace_id"])})

        system_msg = f"""Você é o Copiloto TrakAquire, assistente operacional de uma plataforma de aquisição e atribuição para iGaming.
Workspace: {workspace.get('name', 'N/A') if workspace else 'N/A'}
Moeda: {workspace.get('currency', 'BRL') if workspace else 'BRL'}
Fuso: {workspace.get('timezone', 'America/Sao_Paulo') if workspace else 'America/Sao_Paulo'}

Responda com base nos dados autorizados do workspace. Indique sempre as fontes e períodos.
Não execute ações, apenas sugira. Recomendações operacionais devem passar pelo processo de governança.
Se não houver dados suficientes, informe explicitamente."""

        chat = LlmChat(
            api_key=config["api_key"],
            session_id=f"copilot_{user['_id']}_{user.get('workspace_id', 'none')}",
            system_message=system_msg,
        ).with_model(config["provider"], config["model"])

        user_message = UserMessage(text=body.message)

        async def event_generator():
            full_response = ""
            try:
                async for event in chat.stream_message(user_message):
                    if isinstance(event, TextDelta):
                        full_response += event.content
                        yield f"data: {json.dumps({'content': event.content})}\n\n"
                    elif isinstance(event, StreamDone):
                        break
            except Exception as e:
                logger.error(f"AI stream error: {e}")
                yield f"data: {json.dumps({'error': str(e)})}\n\n"

            # Save assistant response
            await db.copilot_messages.insert_one({
                "workspace_id": user.get("workspace_id"),
                "user_id": user["_id"],
                "role": "assistant",
                "content": full_response,
                "created_at": datetime.now(timezone.utc),
            })
            yield "data: [DONE]\n\n"

        return StreamingResponse(
            event_generator(),
            media_type="text/event-stream",
            headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
        )

    except ImportError:
        raise HTTPException(503, "Biblioteca de IA não disponível")
    except Exception as e:
        logger.error(f"Copilot error: {e}")
        raise HTTPException(500, f"Erro no copiloto: {str(e)}")


@router.get("/copilot/history")
async def copilot_history(request: Request, limit: int = 50):
    user = await get_current_user(request)
    items = await db.copilot_messages.find(
        {"workspace_id": user.get("workspace_id"), "user_id": user["_id"]}
    ).sort("created_at", -1).limit(limit).to_list(limit)
    for item in items:
        item["_id"] = str(item["_id"])
    items.reverse()
    return {"items": items}
