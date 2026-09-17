from fastapi import FastAPI, APIRouter, HTTPException
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
import os
import logging
import random
import string
from pathlib import Path
from pydantic import BaseModel, Field
from typing import List, Optional
import uuid
from datetime import datetime, timezone

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

mongo_url = os.environ['MONGO_URL']
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ['DB_NAME']]

app = FastAPI()
api_router = APIRouter(prefix="/api")

# ===================== MODELS =====================

def new_id(): return str(uuid.uuid4())
def now(): return datetime.now(timezone.utc).isoformat()
def gen_code(): return ''.join(random.choices(string.ascii_uppercase + string.digits, k=6))

class UserCreate(BaseModel):
    phone: str
    password: str
    invite_code: Optional[str] = None

class UserLogin(BaseModel):
    phone: str
    password: str

class CommissionLevelUpdate(BaseModel):
    levels: list  # [{level: 1, name: "Nível 1", percentage: 10}, ...]

# ===================== AUTH =====================

@api_router.post("/auth/register")
async def register(data: UserCreate):
    existing = await db.users.find_one({"phone": data.phone})
    if existing:
        raise HTTPException(400, "Telefone já cadastrado")
    
    referred_by = None
    if data.invite_code:
        referrer = await db.users.find_one({"invite_code": data.invite_code})
        if not referrer:
            raise HTTPException(400, "Código de convite inválido")
        referred_by = referrer["id"]
    
    user = {
        "id": new_id(),
        "phone": data.phone,
        "password": data.password,  # In production, hash this
        "invite_code": gen_code(),
        "referred_by": referred_by,
        "level": "LV1",
        "type": "comum",
        "balance": 0,
        "earnings_balance": 0,
        "today_earnings": 0,
        "total_earnings": 0,
        "created_at": now(),
    }
    await db.users.insert_one(user)
    
    # If referred, distribute commissions up the chain
    if referred_by:
        await distribute_registration_commission(user["id"], referred_by)
    
    user.pop("_id", None)
    user.pop("password", None)
    return user

@api_router.post("/auth/login")
async def login(data: UserLogin):
    user = await db.users.find_one({"phone": data.phone, "password": data.password})
    if not user:
        raise HTTPException(401, "Credenciais inválidas")
    user.pop("_id", None)
    user.pop("password", None)
    return user

# ===================== USER =====================

@api_router.get("/users/{user_id}")
async def get_user(user_id: str):
    user = await db.users.find_one({"id": user_id}, {"_id": 0, "password": 0})
    if not user:
        raise HTTPException(404, "Usuário não encontrado")
    return user

@api_router.get("/users/{user_id}/team")
async def get_team(user_id: str):
    # Get all direct referrals (level B)
    directs = await db.users.find({"referred_by": user_id}, {"_id": 0, "password": 0}).to_list(1000)
    # Count total team earnings
    commissions = await db.commissions.find({"to_user": user_id}).to_list(10000)
    total = sum(c.get("amount", 0) for c in commissions)
    today = now()[:10]
    today_total = sum(c.get("amount", 0) for c in commissions if c.get("created_at", "")[:10] == today)
    return {
        "members": directs,
        "total_earnings": total,
        "today_earnings": today_total,
        "total_members": len(directs),
    }

@api_router.get("/users/{user_id}/commissions")
async def get_commissions(user_id: str):
    commissions = await db.commissions.find({"to_user": user_id}, {"_id": 0}).sort("created_at", -1).to_list(1000)
    return commissions

@api_router.get("/users/{user_id}/network")
async def get_network(user_id: str):
    """Get full downline tree for a user"""
    return await build_tree(user_id, 1)

async def build_tree(user_id: str, depth: int):
    if depth > 20:  # safety limit
        return []
    children = await db.users.find({"referred_by": user_id}, {"_id": 0, "password": 0}).to_list(1000)
    result = []
    for c in children:
        subtree = await build_tree(c["id"], depth + 1)
        result.append({
            "user": c,
            "level": depth,
            "children": subtree,
            "children_count": len(subtree),
        })
    return result

# ===================== COMMISSION LOGIC =====================

async def get_commission_levels():
    levels = await db.commission_config.find({}, {"_id": 0}).sort("level", 1).to_list(100)
    if not levels:
        # Default: 3 levels
        defaults = [
            {"level": 1, "name": "Nível 1 (Direto)", "percentage": 10},
            {"level": 2, "name": "Nível 2", "percentage": 5},
            {"level": 3, "name": "Nível 3", "percentage": 2},
        ]
        for d in defaults:
            await db.commission_config.insert_one(d)
        return defaults
    return levels

async def distribute_registration_commission(new_user_id: str, referrer_id: str):
    """Walk up the referral chain and pay commission per level"""
    levels = await get_commission_levels()
    max_depth = len(levels)
    
    current_id = referrer_id
    for depth in range(max_depth):
        if not current_id:
            break
        
        user = await db.users.find_one({"id": current_id})
        if not user:
            break
        
        pct = levels[depth]["percentage"]
        # Commission is percentage-based on a base value (e.g., registration bonus = R$100)
        base_value = 100  
        amount = round(base_value * pct / 100, 2)
        
        commission = {
            "id": new_id(),
            "from_user": new_user_id,
            "to_user": current_id,
            "amount": amount,
            "percentage": pct,
            "level": depth + 1,
            "level_name": levels[depth]["name"],
            "type": "referral",
            "created_at": now(),
        }
        await db.commissions.insert_one(commission)
        
        # Update user balance
        await db.users.update_one(
            {"id": current_id},
            {"$inc": {"earnings_balance": amount, "total_earnings": amount}}
        )
        
        # Move up the chain
        current_id = user.get("referred_by")

# ===================== ADMIN =====================

@api_router.get("/admin/commission-levels")
async def admin_get_levels():
    return await get_commission_levels()

@api_router.put("/admin/commission-levels")
async def admin_set_levels(data: CommissionLevelUpdate):
    await db.commission_config.delete_many({})
    for lvl in data.levels:
        await db.commission_config.insert_one({
            "level": lvl["level"],
            "name": lvl["name"],
            "percentage": lvl["percentage"],
        })
    return {"ok": True, "levels": data.levels}

@api_router.get("/admin/users")
async def admin_list_users():
    users = await db.users.find({}, {"_id": 0, "password": 0}).to_list(10000)
    return users

@api_router.get("/admin/user/{user_id}/network")
async def admin_user_network(user_id: str):
    tree = await build_tree(user_id, 1)
    return tree

@api_router.get("/admin/commissions")
async def admin_all_commissions():
    comms = await db.commissions.find({}, {"_id": 0}).sort("created_at", -1).to_list(10000)
    return comms

@api_router.get("/admin/stats")
async def admin_stats():
    total_users = await db.users.count_documents({})
    total_comms = await db.commissions.count_documents({})
    pipeline = [{"$group": {"_id": None, "total": {"$sum": "$amount"}}}]
    agg = await db.commissions.aggregate(pipeline).to_list(1)
    total_paid = agg[0]["total"] if agg else 0
    return {"total_users": total_users, "total_commissions": total_comms, "total_paid": round(total_paid, 2)}

@api_router.delete("/admin/reset")
async def admin_reset():
    """Dev only: reset all data"""
    await db.users.delete_many({})
    await db.commissions.delete_many({})
    return {"ok": True}

# ===================== EXISTING =====================

@api_router.get("/")
async def root():
    return {"message": "TaxiNexo API"}

app.include_router(api_router)

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()
