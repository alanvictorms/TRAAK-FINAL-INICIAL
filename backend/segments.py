"""Condições de segmento → filtro do Mongo sobre `players`.

Formato gravado pela tela: {campo: {"op": operador, "value": texto}} e
`logic` "and"/"or". Valores chegam como texto ("true", "1000", "10,50").
"""
import re
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, Optional

from attribution import normalize_source, source_variants

FIELDS = {
    "has_ftd": "Fez FTD",
    "origin": "Entrou via",
    "source": "Fonte de aquisição",
    "tag": "Etiqueta",
    "total_deposits": "Total depositado",
    "total_withdrawals": "Total sacado",
    "days_since_click": "Dias desde a entrada",
    "has_telegram": "Tem Telegram",
    "has_phone": "Tem telefone",
    "registered": "Cadastrado na casa",
    "net_negative": "Sacou mais que depositou",
    "stage": "Etapa",
}
BOOL_FIELDS = {"has_ftd", "has_telegram", "has_phone", "registered", "net_negative"}
NUMBER_FIELDS = {"total_deposits", "total_withdrawals", "days_since_click"}
TRUE = {"true", "sim", "1", "yes"}


class SegmentError(ValueError):
    pass


def _truth(op: str, value: Any) -> bool:
    if op == "sim":
        return True
    if op == "não":
        return False
    return str(value).strip().lower() in TRUE


def _number(value: Any) -> float:
    try:
        return float(str(value).replace(",", ".").strip())
    except ValueError:
        raise SegmentError(f"Valor numérico inválido: {value!r}")


def _range(value: Any):
    """'100 500', '100-500', '100 a 500' → (100.0, 500.0)."""
    numbers = re.findall(r"\d+(?:[.,]\d+)?", str(value))
    if len(numbers) != 2:
        raise SegmentError("Use 'entre' com dois números, ex.: 100 500")
    return tuple(sorted(_number(n) for n in numbers))


def _numeric(path: str, op: str, value: Any) -> Dict[str, Any]:
    if op == "maior_que":
        return {path: {"$gt": _number(value)}}
    if op == "menor_que":
        return {path: {"$lt": _number(value)}}
    if op == "igual":
        return {path: _number(value)}
    if op == "entre":
        low, high = _range(value)
        return {path: {"$gte": low, "$lte": high}}
    raise SegmentError(f"Operador {op} não serve para números")


def _text(path: str, op: str, value: Any) -> Dict[str, Any]:
    text = str(value or "").strip()
    if op == "igual":
        return {path: {"$regex": f"^{re.escape(text)}$", "$options": "i"}}
    if op == "contém":
        return {path: {"$regex": re.escape(text), "$options": "i"}}
    raise SegmentError(f"Operador {op} não serve para texto")


def condition_filter(field: str, op: str, value: Any, now: datetime) -> Dict[str, Any]:
    if field not in FIELDS:
        raise SegmentError(f"Campo desconhecido: {field}")
    if field in BOOL_FIELDS:
        want = _truth(op, value)
        if field == "has_ftd":
            return {"has_ftd": True} if want else {"has_ftd": {"$ne": True}}
        if field == "has_telegram":
            return {"external_ids.telegram_user_id": {"$exists": want}}
        if field == "has_phone":
            return {"contact.phone": {"$nin": [None, ""]}} if want else {"contact.phone": {"$in": [None, ""]}}
        if field == "registered":
            return {"registered_at": {"$ne": None}} if want else {"registered_at": None}
        expr = {"$gt": [{"$ifNull": ["$total_withdrawals", 0]}, {"$ifNull": ["$total_deposits", 0]}]}
        return {"$expr": expr} if want else {"$expr": {"$not": [expr]}}
    if field == "days_since_click":
        # Dias desde a entrada viram limites em created_at.
        ago = lambda d: now - timedelta(days=d)  # noqa: E731
        if op == "maior_que":
            return {"created_at": {"$lt": ago(_number(value))}}
        if op == "menor_que":
            return {"created_at": {"$gt": ago(_number(value))}}
        if op == "entre":
            low, high = _range(value)
            return {"created_at": {"$gte": ago(high), "$lte": ago(low)}}
        if op == "igual":
            d = _number(value)
            return {"created_at": {"$gte": ago(d + 1), "$lt": ago(d)}}
        raise SegmentError(f"Operador {op} não serve para dias")
    if field in NUMBER_FIELDS:
        return _numeric(field, op, value)
    if field == "source":
        wanted = normalize_source(str(value or ""))
        return {"source": {"$in": source_variants(wanted)}}
    if field == "tag":
        return {"tags": str(value or "").strip().lower()} if op in ("igual", "contém", "sim") else {"tags": {"$ne": str(value).strip().lower()}}
    if field == "stage":
        return _text("pipeline_stage", op, value)
    return _text("origin", op, value)


def segment_query(workspace_id: str, conditions: Optional[Dict[str, Any]], logic: str = "and",
                  now: Optional[datetime] = None) -> Dict[str, Any]:
    now = now or datetime.now(timezone.utc)
    parts = [condition_filter(field, (c or {}).get("op", "igual"), (c or {}).get("value"), now)
             for field, c in (conditions or {}).items()]
    base = {"workspace_id": workspace_id, "blocked": {"$ne": True}}
    if not parts:
        return base
    return {**base, ("$or" if logic == "or" else "$and"): parts}


OPT_OUT_WORDS = {"pare", "parar", "sair", "stop", "cancelar", "descadastrar"}


def is_opt_out(text: Optional[str]) -> bool:
    return (text or "").strip().lower().strip(".! ") in OPT_OUT_WORDS
