import os
from motor.motor_asyncio import AsyncIOMotorClient

# tz_aware: sem isso o Mongo devolve datas sem fuso. A API as serializava sem
# 'Z' (o navegador lia como hora local, 3h errado) e toda comparação com
# datetime.now(timezone.utc) lançava TypeError — bloqueio de login e reset
# de senha respondiam 500.
client = AsyncIOMotorClient(os.environ['MONGO_URL'], tz_aware=True)
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
