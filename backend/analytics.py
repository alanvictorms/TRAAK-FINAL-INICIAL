"""Períodos, buckets e variações — a matemática das telas de Analytics."""
from datetime import datetime, timedelta, timezone
from statistics import median
from typing import Dict, List, Optional, Tuple
from zoneinfo import ZoneInfo

PERIODS = {"24h": timedelta(hours=24), "7d": timedelta(days=7), "30d": timedelta(days=30), "90d": timedelta(days=90)}
GRANULARITIES = ("hour", "day", "week", "month")
MAX_BUCKETS = 200

# O funil do produto, na ordem em que o lead anda.
FUNNEL = [
    ("click", "Clique"),
    ("bot_start", "StartBot"),
    ("channel_join", "Entrada no canal"),
    ("register", "Cadastro"),
    ("ftd", "FTD"),
]

CLOSE_REASONS = {
    "converted": "Convertido",
    "no_response": "Sem resposta",
    "not_interested": "Sem interesse",
    "spam": "Spam",
    "duplicate": "Duplicado",
    "other": "Outro",
    "blocked": "Bloqueado",
}


def workspace_tz(name: Optional[str]):
    try:
        return ZoneInfo(name or "America/Sao_Paulo")
    except Exception:  # noqa: BLE001 — fuso inválido ou base de fusos ausente
        return timezone.utc


def resolve_period(period: str, now: Optional[datetime] = None) -> Tuple[datetime, datetime, datetime]:
    """(início do anterior, início do atual, fim) — janelas de mesmo tamanho."""
    if period not in PERIODS:
        raise ValueError("Período deve ser 24h, 7d, 30d ou 90d")
    end = now or datetime.now(timezone.utc)
    size = PERIODS[period]
    return end - 2 * size, end - size, end


def _truncate(local: datetime, granularity: str) -> datetime:
    if granularity == "hour":
        return local.replace(minute=0, second=0, microsecond=0)
    day = local.replace(hour=0, minute=0, second=0, microsecond=0)
    if granularity == "day":
        return day
    if granularity == "week":
        return day - timedelta(days=day.weekday())  # semana começa na segunda
    return day.replace(day=1)


def _advance(local: datetime, granularity: str) -> datetime:
    if granularity == "hour":
        return local + timedelta(hours=1)
    if granularity == "day":
        return local + timedelta(days=1)
    if granularity == "week":
        return local + timedelta(days=7)
    return (local.replace(day=28) + timedelta(days=4)).replace(day=1)


def buckets(start: datetime, end: datetime, granularity: str, tz) -> List[datetime]:
    """Inícios de bucket (em UTC) cobrindo [start, end), alinhados ao fuso do workspace."""
    if granularity not in GRANULARITIES:
        raise ValueError("Granularidade deve ser hour, day, week ou month")
    cur = _truncate(start.astimezone(tz), granularity)
    out = []
    while cur < end.astimezone(tz):
        # Recalcular o fuso a cada passo respeita horário de verão, se houver.
        out.append(cur.replace(tzinfo=None).replace(tzinfo=tz).astimezone(timezone.utc))
        cur = _advance(cur.replace(tzinfo=None), granularity).replace(tzinfo=tz)
        if len(out) > MAX_BUCKETS:
            raise ValueError("Granularidade fina demais para o período")
    return out


def pct_change(current: Optional[float], previous: Optional[float]) -> Optional[float]:
    """Variação percentual. Sem base (anterior 0 ou ausente) não há variação: None."""
    if current is None or not previous:
        return None
    return round((current - previous) / previous * 100, 1)


def ratio(num: Optional[float], den: Optional[float], pct: bool = False) -> Optional[float]:
    if num is None or not den:
        return None
    value = num / den
    return round(value * 100, 1) if pct else round(value, 2)


def funnel_steps(counts: Dict[str, int], previous: Dict[str, int]) -> List[Dict]:
    steps, prev_count = [], None
    first = counts.get(FUNNEL[0][0], 0)
    for key, label in FUNNEL:
        count = counts.get(key, 0)
        steps.append({
            "key": key,
            "label": label,
            "count": count,
            "previous": previous.get(key, 0),
            "change": pct_change(count, previous.get(key, 0)),
            # Conversão do degrau anterior para este, e desde o topo.
            "step_rate": ratio(count, prev_count, pct=True) if prev_count is not None else None,
            "total_rate": ratio(count, first, pct=True),
        })
        prev_count = count
    return steps


def response_minutes(pairs: List[Tuple[datetime, datetime]]) -> Dict[str, Optional[float]]:
    """Tempo de 1ª resposta a partir de (criada, respondida)."""
    minutes = [(r - c).total_seconds() / 60 for c, r in pairs if c and r and r >= c]
    if not minutes:
        return {"avg": None, "median": None, "count": 0}
    return {"avg": round(sum(minutes) / len(minutes), 1), "median": round(median(minutes), 1), "count": len(minutes)}
