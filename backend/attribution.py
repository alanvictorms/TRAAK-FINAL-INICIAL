"""Regras puras do caminho clique → redirect → bot → canal.

Nada aqui toca o banco: é o que decide para onde um clique vai e como o
click_id atravessa até o Telegram. As rotas só buscam e gravam.
"""
import random
import re
from typing import Any, Dict, List, Optional
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

TELEGRAM_HOSTS = {"t.me", "telegram.me", "www.t.me"}
# Limite do Telegram para o parâmetro de /start: 1–64 de [A-Za-z0-9_-].
START_PARAM = re.compile(r"^[A-Za-z0-9_-]{1,64}$")
MOBILE_UA = re.compile(r"Mobi|Android|iPhone|iPad|iPod", re.IGNORECASE)


# Aliases que chegam em utm_source / campaign.platform / event.source.
SOURCE_ALIASES = {
    "facebook": "meta", "fb": "meta", "instagram": "meta", "ig": "meta", "meta": "meta",
    "tiktok": "tiktok", "tt": "tiktok",
    "google": "google", "adwords": "google", "gads": "google", "youtube": "google",
    "kwai": "kwai",
}


def normalize_source(value: Optional[str]) -> str:
    key = (value or "").strip().lower()
    if not key:
        return "direct"
    return SOURCE_ALIASES.get(key, key)


def source_variants(normalized: str) -> List[Optional[str]]:
    """Todos os valores brutos que normalizam para a fonte pedida (para filtrar no banco)."""
    if normalized == "direct":
        return [None, ""]
    raw = {k for k, v in SOURCE_ALIASES.items() if v == normalized} | {normalized}
    # O banco guarda como veio: cobre caixa alta também.
    return sorted(raw | {r.capitalize() for r in raw} | {r.upper() for r in raw})


def device_from_ua(user_agent: Optional[str]) -> str:
    return "mobile" if MOBILE_UA.search(user_agent or "") else "desktop"


def pick_variant(variants: List[Dict[str, Any]], rnd: Optional[random.Random] = None) -> Optional[Dict[str, Any]]:
    """Sorteia uma variante A/B pelo peso. Peso ausente ou <= 0 não participa."""
    pool = [v for v in variants or [] if v.get("destination") and float(v.get("weight") or 0) > 0]
    if not pool:
        return None
    total = sum(float(v["weight"]) for v in pool)
    point = (rnd or random).uniform(0, total)
    for variant in pool:
        point -= float(variant["weight"])
        if point <= 0:
            return variant
    return pool[-1]


def _hour_matches(hour: int, spec: str) -> bool:
    """'18-23' casa 18..23; '22-2' atravessa a meia-noite; '9' casa só 9."""
    try:
        if "-" in spec:
            start, end = (int(x) for x in spec.split("-", 1))
            return start <= hour <= end if start <= end else hour >= start or hour <= end
        return hour == int(spec)
    except ValueError:
        return False


def match_rule(rules: List[Dict[str, Any]], ctx: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    """Primeira regra que casa com o contexto do clique. Ordem é prioridade."""
    for rule in rules or []:
        values = [str(v).strip() for v in rule.get("values") or [] if str(v).strip()]
        if not values or not rule.get("destination"):
            continue
        kind = rule.get("type")
        if kind == "device" and ctx.get("device") in values:
            return rule
        if kind == "country" and (ctx.get("country") or "").upper() in {v.upper() for v in values}:
            return rule
        if kind == "hour" and any(_hour_matches(ctx.get("hour", -1), v) for v in values):
            return rule
    return None


def build_destination(url: str, click_id: str) -> str:
    """Leva o click_id adiante.

    `{click_id}` explícito na URL é substituído. Para t.me sem `start`, o
    click_id vira o parâmetro de /start — é por ele que o bot sabe de qual
    clique o lead veio. Em outros destinos, sem placeholder, nada é inventado:
    cada casa espera o id num parâmetro diferente.
    """
    url = url.replace("{click_id}", click_id)
    parts = urlsplit(url)
    if parts.netloc.lower() in TELEGRAM_HOSTS:
        query = dict(parse_qsl(parts.query, keep_blank_values=True))
        if not query.get("start"):
            query["start"] = click_id
            url = urlunsplit(parts._replace(query=urlencode(query)))
    return url


def start_param(text: Optional[str]) -> Optional[str]:
    """'/start abc' → 'abc'; '/start@MeuBot abc' → 'abc'; sem parâmetro → None."""
    if not text or not text.startswith("/start"):
        return None
    parts = text.split(maxsplit=1)
    if not parts[0].split("@")[0] == "/start" or len(parts) < 2:
        return None
    param = parts[1].strip()
    return param if START_PARAM.match(param) else None


def is_start_command(text: Optional[str]) -> bool:
    parts = (text or "").split(maxsplit=1)
    return bool(parts) and parts[0].split("@")[0] == "/start"


def _is_member(member: Optional[Dict[str, Any]]) -> bool:
    member = member or {}
    status = member.get("status")
    # 'restricted' pode estar dentro ou fora: o Telegram diz em is_member.
    if status == "restricted":
        return bool(member.get("is_member"))
    return status in {"member", "administrator", "creator"}


def membership_change(update: Dict[str, Any]) -> Optional[str]:
    """chat_member: 'channel_join', 'channel_leave' ou None (mudança de cargo etc.)."""
    was = _is_member(update.get("old_chat_member"))
    now = _is_member(update.get("new_chat_member"))
    if now and not was:
        return "channel_join"
    if was and not now:
        return "channel_leave"
    return None
