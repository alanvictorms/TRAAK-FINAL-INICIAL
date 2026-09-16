from fastapi import APIRouter, HTTPException, Request, Response
from datetime import datetime, timezone
from bson import ObjectId
import secrets
from database import db
from auth import (
    hash_password, verify_password,
    create_access_token, create_refresh_token, get_current_user,
)
from models import UserCreate, UserLogin, ForgotPassword, ResetPassword
import jwt, os

router = APIRouter(prefix="/api/auth", tags=["auth"])


def set_auth_cookies(response: Response, access: str, refresh: str):
    response.set_cookie("access_token", access, httponly=True, secure=True, samesite="none", max_age=3600, path="/")
    response.set_cookie("refresh_token", refresh, httponly=True, secure=True, samesite="none", max_age=604800, path="/")


def user_response(user: dict) -> dict:
    return {
        "id": str(user["_id"]),
        "email": user["email"],
        "name": user.get("name", ""),
        "role": user.get("role", "member"),
        "workspace_id": user.get("workspace_id"),
        "is_platform_admin": user.get("is_platform_admin", False),
        "created_at": user.get("created_at", "").isoformat() if isinstance(user.get("created_at"), datetime) else str(user.get("created_at", "")),
    }


@router.post("/register")
async def register(body: UserCreate, response: Response):
    email = body.email.strip().lower()
    if await db.users.find_one({"email": email}):
        raise HTTPException(400, "E-mail já cadastrado")
    if len(body.password) < 8:
        raise HTTPException(400, "Senha deve ter pelo menos 8 caracteres")

    now = datetime.now(timezone.utc)
    # Create workspace for user
    workspace = {
        "name": body.name.strip() + " Workspace",
        "slug": email.split("@")[0],
        "timezone": "America/Sao_Paulo",
        "currency": "BRL",
        "modules": {
            "tracking": True, "identity": True, "automations": True,
            "inbox": True, "ledger": True, "reports": True,
            "financeiro": True, "campaigns": True, "segments": True, "disparos": True,
        },
        "onboarding_completed": False,
        "created_at": now,
    }
    ws_result = await db.workspaces.insert_one(workspace)
    ws_id = str(ws_result.inserted_id)

    user_doc = {
        "email": email,
        "password_hash": hash_password(body.password),
        "name": body.name.strip(),
        "role": "owner",
        "workspace_id": ws_id,
        "is_platform_admin": False,
        "mfa_enabled": False,
        "created_at": now,
        "updated_at": now,
    }
    result = await db.users.insert_one(user_doc)
    user_doc["_id"] = result.inserted_id

    # Update workspace owner
    await db.workspaces.update_one({"_id": ws_result.inserted_id}, {"$set": {"owner_id": str(result.inserted_id)}})

    access = create_access_token(str(result.inserted_id), email)
    refresh = create_refresh_token(str(result.inserted_id))
    set_auth_cookies(response, access, refresh)
    resp = user_response(user_doc)
    resp["token"] = access
    return resp


@router.post("/login")
async def login(body: UserLogin, request: Request, response: Response):
    email = body.email.strip().lower()
    ip = request.client.host if request.client else "unknown"
    identifier = f"{ip}:{email}"

    # Check brute force
    attempt = await db.login_attempts.find_one({"identifier": identifier})
    if attempt and attempt.get("count", 0) >= 5:
        lockout = attempt.get("locked_until")
        if lockout and datetime.now(timezone.utc) < lockout:
            raise HTTPException(429, "Muitas tentativas. Tente novamente em 15 minutos.")
        else:
            await db.login_attempts.delete_one({"identifier": identifier})

    user = await db.users.find_one({"email": email})
    if not user or not verify_password(body.password, user.get("password_hash", "")):
        # Record failed attempt
        await db.login_attempts.update_one(
            {"identifier": identifier},
            {
                "$inc": {"count": 1},
                "$set": {"locked_until": datetime.now(timezone.utc) + __import__("datetime").timedelta(minutes=15)},
                "$setOnInsert": {"created_at": datetime.now(timezone.utc)},
            },
            upsert=True,
        )
        raise HTTPException(401, "Credenciais inválidas")

    # Clear attempts on success
    await db.login_attempts.delete_many({"identifier": identifier})

    uid = str(user["_id"])
    access = create_access_token(uid, email)
    refresh = create_refresh_token(uid)
    set_auth_cookies(response, access, refresh)
    resp = user_response(user)
    resp["token"] = access
    return resp


@router.post("/logout")
async def logout(response: Response):
    response.delete_cookie("access_token", path="/")
    response.delete_cookie("refresh_token", path="/")
    return {"detail": "Sessão encerrada"}


@router.get("/me")
async def me(request: Request):
    user = await get_current_user(request)
    return user_response(user)


@router.post("/refresh")
async def refresh(request: Request, response: Response):
    token = request.cookies.get("refresh_token")
    if not token:
        raise HTTPException(401, "Refresh token ausente")
    try:
        payload = jwt.decode(token, os.environ["JWT_SECRET"], algorithms=["HS256"])
        if payload.get("type") != "refresh":
            raise HTTPException(401, "Token inválido")
        user = await db.users.find_one({"_id": ObjectId(payload["sub"])})
        if not user:
            raise HTTPException(401, "Usuário não encontrado")
        access = create_access_token(str(user["_id"]), user["email"])
        set_auth_cookies(response, access, token)
        return {"token": access}
    except jwt.ExpiredSignatureError:
        raise HTTPException(401, "Refresh token expirado")
    except jwt.InvalidTokenError:
        raise HTTPException(401, "Token inválido")


@router.post("/forgot-password")
async def forgot_password(body: ForgotPassword):
    email = body.email.strip().lower()
    user = await db.users.find_one({"email": email})
    # Always return success to prevent email enumeration
    if user:
        token = secrets.token_urlsafe(32)
        await db.password_reset_tokens.insert_one({
            "token": token,
            "user_id": str(user["_id"]),
            "expires_at": datetime.now(timezone.utc) + __import__("datetime").timedelta(hours=1),
            "used": False,
            "created_at": datetime.now(timezone.utc),
        })
        frontend_url = os.environ.get("FRONTEND_URL", "http://localhost:3000")
        print(f"[RESET] {frontend_url}/reset-password?token={token}")
    return {"detail": "Se o e-mail existir, enviaremos instruções de recuperação."}


@router.post("/reset-password")
async def reset_password(body: ResetPassword):
    record = await db.password_reset_tokens.find_one({"token": body.token, "used": False})
    if not record:
        raise HTTPException(400, "Token inválido ou já utilizado")
    if datetime.now(timezone.utc) > record["expires_at"]:
        raise HTTPException(400, "Token expirado")
    if len(body.password) < 8:
        raise HTTPException(400, "Senha deve ter pelo menos 8 caracteres")
    await db.users.update_one(
        {"_id": ObjectId(record["user_id"])},
        {"$set": {"password_hash": hash_password(body.password), "updated_at": datetime.now(timezone.utc)}},
    )
    await db.password_reset_tokens.update_one({"_id": record["_id"]}, {"$set": {"used": True}})
    return {"detail": "Senha redefinida com sucesso"}
