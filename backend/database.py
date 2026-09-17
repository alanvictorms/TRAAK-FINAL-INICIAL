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


async def is_killed(workspace_id, key):
    """Kill switch ligado em Governança = a função está bloqueada no workspace."""
    return bool(await db.kill_switches.find_one({"workspace_id": workspace_id, "key": key, "active": True}, {"_id": 1}))


async def active_policy(workspace_id, policy_type):
    return await db.governance_policies.find_one(
        {"workspace_id": workspace_id, "type": policy_type, "status": "active"}, sort=[("created_at", -1)])
