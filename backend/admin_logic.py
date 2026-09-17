"""Regras puras da administração da plataforma: uso, faturas, custo de IA e SLO."""
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, Iterable, List, Optional

# Medidores cobrados/limitados por plano.
METERS = {
    "events": "Eventos no ledger",
    "messages": "Mensagens trocadas",
    "dispatches": "Mensagens de disparo",
    "ai_replies": "Respostas de IA",
    "users": "Usuários",
}
INVOICE_STATUS = {"open": "Em aberto", "paid": "Paga", "void": "Cancelada", "overdue": "Vencida"}
INCIDENT_STATUS = {"investigating": "Investigando", "identified": "Causa identificada",
                   "monitoring": "Monitorando", "resolved": "Resolvido"}
INCIDENT_IMPACT = {"none": "Sem impacto", "minor": "Impacto pequeno", "major": "Impacto grande", "critical": "Fora do ar"}
DSR_TYPES = {"export": "Exportar dados", "delete": "Apagar dados"}
DSR_STATUS = {"open": "Aberta", "done": "Concluída", "rejected": "Recusada"}
TICKET_STATUS = {"open": "Aberto", "answered": "Respondido", "closed": "Fechado"}
AI_TASKS = {"copilot": "Copiloto do painel", "agent": "Agente de atendimento", "automation": "Bloco de IA nas automações"}

# Preço por 1.000 tokens (entrada+saída somadas) — usado para estimar custo.
MODEL_PRICES = {
    "claude-haiku-4-5-20251001": 0.004,
    "claude-sonnet-5": 0.018,
    "gpt-5.4-mini": 0.003,
}
CHARS_PER_TOKEN = 4


def month_range(month: Optional[str], now: Optional[datetime] = None):
    """'2026-09' → (início, fim). Sem mês, usa o mês corrente."""
    now = now or datetime.now(timezone.utc)
    if month:
        year, mon = (int(part) for part in month.split("-"))
    else:
        year, mon = now.year, now.month
    start = datetime(year, mon, 1, tzinfo=timezone.utc)
    end = datetime(year + (mon == 12), mon % 12 + 1, 1, tzinfo=timezone.utc)
    return start, end, f"{year:04d}-{mon:02d}"


def usage_status(used: int, limit: Optional[int]) -> Dict[str, Any]:
    """Quanto do limite já foi gasto. Sem limite = ilimitado."""
    if not limit:
        return {"used": used, "limit": None, "percent": None, "state": "unlimited"}
    percent = round(used / limit * 100, 1)
    state = "over" if used > limit else "warning" if percent >= 80 else "ok"
    return {"used": used, "limit": limit, "percent": percent, "state": state}


def estimate_tokens(text: str) -> int:
    return max(1, len(text or "") // CHARS_PER_TOKEN)


def estimate_cost(model: str, tokens: int) -> float:
    """ponytail: estimativa por caracteres; trocar quando o provedor devolver o uso real."""
    return round(tokens / 1000 * MODEL_PRICES.get(model, MODEL_PRICES["gpt-5.4-mini"]), 4)


def invoice_lines(plan: Dict[str, Any], usage: Dict[str, Dict[str, Any]]) -> Dict[str, Any]:
    """Assinatura + excedente de cada medidor que passou do limite."""
    lines = [{"description": f"Plano {plan.get('name', '—')}", "quantity": 1,
              "unit_price": float(plan.get("price") or 0), "total": float(plan.get("price") or 0)}]
    overage_prices = plan.get("overage") or {}
    for meter, data in usage.items():
        limit = data.get("limit")
        if not limit or data["used"] <= limit:
            continue
        extra = data["used"] - limit
        unit = float(overage_prices.get(meter) or 0)
        lines.append({"description": f"Excedente: {METERS.get(meter, meter)}", "quantity": extra,
                      "unit_price": unit, "total": round(extra * unit, 2)})
    total = round(sum(line["total"] for line in lines), 2)
    return {"lines": lines, "total": total, "currency": plan.get("currency", "BRL")}


def next_version(versions: Iterable[Dict[str, Any]]) -> int:
    return max((int(v.get("version") or 0) for v in versions), default=0) + 1


def plan_changes(old: Dict[str, Any], new: Dict[str, Any]) -> List[str]:
    """O que mudou entre duas versões do plano, em texto."""
    changes = []
    if float(old.get("price") or 0) != float(new.get("price") or 0):
        changes.append(f"preço {old.get('price')} → {new.get('price')}")
    for key in set((old.get("limits") or {})) | set((new.get("limits") or {})):
        before, after = (old.get("limits") or {}).get(key), (new.get("limits") or {}).get(key)
        if before != after:
            changes.append(f"{METERS.get(key, key)}: {before or 'ilimitado'} → {after or 'ilimitado'}")
    before_features = set(old.get("features") or [])
    after_features = set(new.get("features") or [])
    for feature in sorted(after_features - before_features):
        changes.append(f"liberou {feature}")
    for feature in sorted(before_features - after_features):
        changes.append(f"retirou {feature}")
    return changes


def uptime(beats: List[Dict[str, Any]]) -> Dict[str, Any]:
    """Disponibilidade a partir dos batimentos gravados pelo monitor."""
    total = len(beats)
    if not total:
        return {"uptime": None, "samples": 0, "down": 0}
    down = len([b for b in beats if not b.get("ok")])
    return {"uptime": round((total - down) / total * 100, 3), "samples": total, "down": down}


def slo_state(measured: Optional[float], target: float) -> str:
    if measured is None:
        return "unknown"
    return "ok" if measured >= target else "at_risk" if measured >= target - 0.5 else "breached"


def incident_duration(incident: Dict[str, Any], now: Optional[datetime] = None) -> Optional[int]:
    """Minutos entre o começo e a resolução (ou até agora)."""
    started = incident.get("started_at")
    if not started:
        return None
    end = incident.get("resolved_at") or (now or datetime.now(timezone.utc))
    return max(0, int((end - started).total_seconds() // 60))


def dsr_deadline(created_at: datetime, days: int = 15) -> datetime:
    """LGPD: resposta ao titular em até 15 dias."""
    return created_at + timedelta(days=days)
