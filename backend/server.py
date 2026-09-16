from dotenv import load_dotenv
from pathlib import Path
load_dotenv(Path(__file__).parent / '.env')

from fastapi import FastAPI
from starlette.middleware.cors import CORSMiddleware
import os
import logging
from datetime import datetime, timezone

from database import db, client
from auth import hash_password, verify_password

# Import routers
from routes.auth_routes import router as auth_router
from routes.connect_routes import router as connect_router
from routes.observe_routes import router as observe_router
from routes.operate_routes import router as operate_router
from routes.prove_routes import router as prove_router
from routes.platform_routes import router as platform_router
from routes.copilot_routes import router as copilot_router
from routes.webhook_routes import router as webhook_router

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

app = FastAPI(title="TrakAquire API", version="1.0.0")

# CORS
frontend_url = os.environ.get("FRONTEND_URL", "http://localhost:3000")
app.add_middleware(
    CORSMiddleware,
    allow_origins=[frontend_url, "http://localhost:3000", "https://trakacquire-platform.preview.emergentagent.com"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Include all routers
app.include_router(auth_router)
app.include_router(connect_router)
app.include_router(observe_router)
app.include_router(operate_router)
app.include_router(prove_router)
app.include_router(platform_router)
app.include_router(copilot_router)
app.include_router(webhook_router)


@app.get("/api")
async def root():
    return {"message": "TrakAquire API v1.0", "status": "operational"}


@app.get("/api/health")
async def health():
    return {"status": "ok", "timestamp": datetime.now(timezone.utc).isoformat()}


@app.on_event("startup")
async def startup():
    logger.info("Starting TrakAquire API...")

    # Create indexes
    await db.users.create_index("email", unique=True)
    await db.password_reset_tokens.create_index("expires_at", expireAfterSeconds=0)
    await db.login_attempts.create_index("identifier")
    await db.events.create_index([("workspace_id", 1), ("type", 1)])
    await db.events.create_index([("workspace_id", 1), ("external_id", 1)])
    await db.events.create_index([("workspace_id", 1), ("person_id", 1)])
    await db.players.create_index([("workspace_id", 1)])
    await db.tracking_links.create_index([("workspace_id", 1), ("slug", 1)])
    await db.integrations.create_index([("workspace_id", 1)])
    await db.conversations.create_index([("workspace_id", 1), ("status", 1)])
    await db.audit_log.create_index([("workspace_id", 1), ("timestamp", -1)])

    # Seed admin
    admin_email = os.environ.get("ADMIN_EMAIL", "admin@trakaquire.com")
    admin_password = os.environ.get("ADMIN_PASSWORD", "admin123")

    existing = await db.users.find_one({"email": admin_email})
    if existing is None:
        now = datetime.now(timezone.utc)
        # Create admin workspace
        ws = {
            "name": "TrakAquire Admin",
            "slug": "admin",
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
        ws_result = await db.workspaces.insert_one(ws)
        ws_id = str(ws_result.inserted_id)

        user_doc = {
            "email": admin_email,
            "password_hash": hash_password(admin_password),
            "name": "Administrador",
            "role": "owner",
            "workspace_id": ws_id,
            "is_platform_admin": True,
            "mfa_enabled": False,
            "created_at": now,
            "updated_at": now,
        }
        result = await db.users.insert_one(user_doc)
        await db.workspaces.update_one({"_id": ws_result.inserted_id}, {"$set": {"owner_id": str(result.inserted_id)}})
        logger.info(f"Admin created: {admin_email}")
    elif not verify_password(admin_password, existing.get("password_hash", "")):
        await db.users.update_one({"email": admin_email}, {"$set": {"password_hash": hash_password(admin_password)}})
        logger.info("Admin password updated")

    # Write test credentials
    creds_path = Path("/app/memory/test_credentials.md")
    creds_path.parent.mkdir(parents=True, exist_ok=True)
    creds_path.write_text(
        f"# Test Credentials\n\n"
        f"## Admin Account\n"
        f"- Email: {admin_email}\n"
        f"- Password: {admin_password}\n"
        f"- Role: owner + platform_admin\n\n"
        f"## Auth Endpoints\n"
        f"- POST /api/auth/login\n"
        f"- POST /api/auth/register\n"
        f"- POST /api/auth/logout\n"
        f"- GET /api/auth/me\n"
        f"- POST /api/auth/refresh\n"
    )
    logger.info("TrakAquire API ready")


@app.on_event("shutdown")
async def shutdown():
    client.close()
