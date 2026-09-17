from pydantic import BaseModel, Field, ConfigDict
from typing import Optional, List, Dict, Any, Annotated
from datetime import datetime, timezone
from bson import ObjectId
from pydantic.functional_validators import BeforeValidator

PyObjectId = Annotated[str, BeforeValidator(lambda v: str(v) if isinstance(v, ObjectId) else v)]


class BaseDocument(BaseModel):
    model_config = ConfigDict(populate_by_name=True, arbitrary_types_allowed=True)
    id: Optional[PyObjectId] = Field(default=None, alias="_id")

    @classmethod
    def from_mongo(cls, doc):
        if doc is None:
            return None
        if "_id" in doc:
            doc["_id"] = str(doc["_id"])
        return cls(**doc)

    def to_mongo(self):
        d = self.model_dump(by_alias=True, exclude_none=True)
        d.pop("_id", None)
        return d


# ── Auth ──
class UserCreate(BaseModel):
    email: str
    password: str
    name: str

class UserLogin(BaseModel):
    email: str
    password: str

class ForgotPassword(BaseModel):
    email: str

class ResetPassword(BaseModel):
    token: str
    password: str

class UserResponse(BaseModel):
    id: str
    email: str
    name: str
    role: str
    workspace_id: Optional[str] = None
    is_platform_admin: bool = False
    created_at: Optional[str] = None


# ── Integrations ──
class IntegrationCreate(BaseModel):
    provider: str
    category: str
    name: str
    credentials: Dict[str, Any] = {}
    config: Dict[str, Any] = {}
    capabilities: List[str] = []

class IntegrationUpdate(BaseModel):
    name: Optional[str] = None
    status: Optional[str] = None
    credentials: Optional[Dict[str, Any]] = None
    config: Optional[Dict[str, Any]] = None


# ── Domains ──
class DomainCreate(BaseModel):
    domain: str
    purpose: str = "tracking"

class DomainUpdate(BaseModel):
    status: Optional[str] = None
    ssl_status: Optional[str] = None


# ── Tracking ──
class TrackingLinkCreate(BaseModel):
    name: str
    slug: str
    destination: str
    domain_id: Optional[str] = None
    utm_source: Optional[str] = None
    utm_medium: Optional[str] = None
    utm_campaign: Optional[str] = None
    utm_content: Optional[str] = None
    utm_term: Optional[str] = None
    expert_id: Optional[str] = None
    campaign_id: Optional[str] = None
    ab_variants: List[Dict[str, Any]] = []
    rules: List[Dict[str, Any]] = []


# ── Events / Ledger ──
class EventCreate(BaseModel):
    type: str
    person_id: Optional[str] = None
    source: Optional[str] = None
    value: Optional[float] = None
    currency: Optional[str] = None
    external_id: Optional[str] = None
    metadata: Dict[str, Any] = {}


# ── Players ──
class PlayerCreate(BaseModel):
    name: Optional[str] = None
    external_ids: Dict[str, str] = {}
    origin: Optional[str] = None
    expert_id: Optional[str] = None
    tags: List[str] = []

class PlayerUpdate(BaseModel):
    name: Optional[str] = None
    tags: Optional[List[str]] = None
    origin: Optional[str] = None


# ── Inbox ──
class ConversationCreate(BaseModel):
    player_id: str
    channel: str = "telegram"
    subject: Optional[str] = None

class MessageCreate(BaseModel):
    content: str
    type: str = "reply"

class LeadDetailUpdate(BaseModel):
    name: Optional[str] = None
    status: Optional[str] = None
    pipeline_stage: Optional[str] = None
    expert_name: Optional[str] = None
    budget: Optional[float] = None
    phone: Optional[str] = None
    email: Optional[str] = None
    tags: Optional[List[str]] = None
    internal_notes: Optional[str] = None
    blocked: Optional[bool] = None

class LeadTaskCreate(BaseModel):
    title: str
    due_at: Optional[str] = None


# ── Segments ──
class SegmentCreate(BaseModel):
    name: str
    conditions: Dict[str, Any] = {}
    logic: str = "and"


# ── Automations ──
class AutomationCreate(BaseModel):
    name: str
    trigger: Dict[str, Any] = {}
    nodes: List[Dict[str, Any]] = []
    edges: List[Dict[str, Any]] = []
    connection_id: Optional[str] = None
    status: str = "draft"

class AutomationUpdate(BaseModel):
    name: Optional[str] = None
    status: Optional[str] = None
    trigger: Optional[Dict[str, Any]] = None
    nodes: Optional[List[Dict[str, Any]]] = None
    edges: Optional[List[Dict[str, Any]]] = None
    connection_id: Optional[str] = None


# ── Dispatches ──
class DispatchCreate(BaseModel):
    name: str
    channel: str
    segment_id: Optional[str] = None
    content: Dict[str, Any] = {}
    scheduled_at: Optional[str] = None
    recurrence: Optional[Dict[str, Any]] = None


# ── Campaigns ──
class CampaignCreate(BaseModel):
    name: str
    platform: str
    status: str = "draft"
    budget: Optional[float] = None
    expert_id: Optional[str] = None


# ── Reports ──
class ReportCreate(BaseModel):
    name: str
    type: str = "custom"
    metrics: List[str] = []
    dimensions: List[str] = []
    period: Optional[str] = None
    filters: Dict[str, Any] = {}


# ── Governance ──
class ApprovalCreate(BaseModel):
    type: str
    object_id: str
    object_type: str
    plan: Dict[str, Any] = {}
    justification: str = ""


# ── Platform Admin ──
class AIProviderCreate(BaseModel):
    name: str
    provider: str
    model: str
    api_key: str
    status: str = "active"
    config: Dict[str, Any] = {}

class AIProviderUpdate(BaseModel):
    name: Optional[str] = None
    model: Optional[str] = None
    api_key: Optional[str] = None
    status: Optional[str] = None
    config: Optional[Dict[str, Any]] = None

class TenantCreate(BaseModel):
    name: str
    plan: str = "starter"
    owner_email: str
    environment: str = "production"

class PlanCreate(BaseModel):
    name: str
    price: float = 0
    currency: str = "BRL"
    features: Dict[str, Any] = {}
    limits: Dict[str, Any] = {}

class TeamMemberInvite(BaseModel):
    email: str
    role: str = "member"

class APIKeyCreate(BaseModel):
    name: str
    scopes: List[str] = []

class WorkspaceSettingsUpdate(BaseModel):
    name: Optional[str] = None
    timezone: Optional[str] = None
    currency: Optional[str] = None
    modules: Optional[Dict[str, bool]] = None

class CopilotMessage(BaseModel):
    message: str
    context: Optional[Dict[str, Any]] = None
