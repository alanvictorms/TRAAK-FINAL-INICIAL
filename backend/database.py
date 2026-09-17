import os
from motor.motor_asyncio import AsyncIOMotorClient

client = AsyncIOMotorClient(os.environ['MONGO_URL'])
db = client[os.environ['DB_NAME']]


async def audit(user, action, object_id=None, object_type=None):
    """Registro de auditoria no formato que a tela Configurações > Auditoria lê."""
    from datetime import datetime, timezone
    await db.audit_log.insert_one({
        "workspace_id": user.get("workspace_id"),
        "user_id": user["_id"],
        "user_email": user.get("email", ""),
        "action": action,
        "object_id": object_id,
        "object_type": object_type,
        "timestamp": datetime.now(timezone.utc),
    })
