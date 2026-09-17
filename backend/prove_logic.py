"""Regras puras de Receita, Relatórios e Governança."""
from datetime import datetime, timedelta
from typing import Any, Dict, Iterable, List, Optional

KILL_SWITCHES = {
    "dispatches": "Envio de disparos",
    "automations": "Execução de automações",
    "capi": "Envio de conversões para a Meta (CAPI)",
    "ai": "Copiloto e respostas por IA",
    "ingest_tap": "Recebimento de postbacks da casa (TAP)",
}

POLICY_TYPES = {
    "dispatch_approval": "Disparo grande exige aprovação",
    "send_window": "Janela de envio de disparos",
}

REPORT_METRICS = {
    "clicks": "Cliques", "bot_starts": "StartBots", "channel_joins": "Entradas no canal",
    "registrations": "Cadastros", "ftds": "FTDs", "ftd_value": "Valor em FTD",
    "deposits": "Depósitos", "withdrawals": "Saques", "net_deposits": "Depósito líquido",
}
REPORT_DIMENSIONS = {"source": "Fonte", "day": "Dia", "campaign": "Campanha", "link": "Link"}
REPORT_PERIODS = {"1d": "24h", "7d": "7d", "30d": "30d", "90d": "90d"}
FREQUENCIES = {"daily", "weekly", "monthly"}

TYPE_COUNTERS = {"click": "clicks", "bot_start": "bot_starts", "channel_join": "channel_joins",
                 "register": "registrations", "ftd": "ftds"}


def policy_errors(policy_type: str, config: Dict[str, Any]) -> List[str]:
    if policy_type not in POLICY_TYPES:
        return ["Tipo de política desconhecido"]
    if policy_type == "dispatch_approval":
        try:
            if int(config.get("min_recipients")) < 1:
                raise ValueError
        except (TypeError, ValueError):
            return ["Informe a partir de quantos destinatários exige aprovação"]
    if policy_type == "send_window":
        try:
            start, end = int(config.get("start_hour")), int(config.get("end_hour"))
            if not (0 <= start <= 23 and 0 <= end <= 23):
                raise ValueError
        except (TypeError, ValueError):
            return ["Janela precisa de hora inicial e final entre 0 e 23"]
    return []


def in_send_window(hour: int, start: int, end: int) -> bool:
    """Janela 8–20 inclui 8h até 19h59; 22–6 atravessa a meia-noite."""
    if start == end:
        return True
    return start <= hour < end if start < end else hour >= start or hour < end


def row_metrics(counts: Dict[str, Dict[str, float]]) -> Dict[str, float]:
    """counts: {tipo_evento: {count, value}} → métricas do relatório."""
    out = {name: counts.get(t, {}).get("count", 0) for t, name in TYPE_COUNTERS.items()}
    ftd_value = counts.get("ftd", {}).get("value", 0) or 0
    deposits = (counts.get("deposit", {}).get("value", 0) or 0) + ftd_value
    withdrawals = counts.get("withdrawal", {}).get("value", 0) or 0
    out.update({"ftd_value": round(ftd_value, 2), "deposits": round(deposits, 2),
                "withdrawals": round(withdrawals, 2), "net_deposits": round(deposits - withdrawals, 2)})
    return out


def next_run(schedule: Dict[str, Any], after: datetime, tz) -> datetime:
    """Próxima execução estritamente depois de `after`, na hora local do workspace."""
    freq = schedule.get("frequency")
    hour = int(schedule.get("hour", 8))
    local = after.astimezone(tz)
    candidate = local.replace(hour=hour, minute=0, second=0, microsecond=0)
    if freq == "daily":
        if candidate <= local:
            candidate += timedelta(days=1)
    elif freq == "weekly":
        weekday = int(schedule.get("weekday", 0))
        candidate += timedelta(days=(weekday - candidate.weekday()) % 7)
        if candidate <= local:
            candidate += timedelta(days=7)
    elif freq == "monthly":
        day = min(int(schedule.get("day", 1)), 28)
        candidate = candidate.replace(day=day)
        if candidate <= local:
            month = candidate.month % 12 + 1
            candidate = candidate.replace(year=candidate.year + (candidate.month == 12), month=month)
    else:
        raise ValueError("Frequência deve ser daily, weekly ou monthly")
    return candidate.astimezone(after.tzinfo)


def reconcile(file_rows: Iterable[Dict[str, Any]], ledger: Dict[str, float], tolerance: float = 0.01) -> Dict[str, Any]:
    """Confronta o extrato da casa com o ledger, transação por transação.

    file_rows: [{transaction_id, amount}]; ledger: {external_id: valor}.
    """
    matched, mismatched, missing_in_ledger, seen = [], [], [], set()
    file_total = 0.0
    for row in file_rows:
        tx = str(row.get("transaction_id") or "").strip()
        if not tx or tx in seen:
            continue
        seen.add(tx)
        try:
            amount = float(str(row.get("amount") or 0).replace(",", "."))
        except ValueError:
            amount = 0.0
        file_total += amount
        if tx not in ledger:
            missing_in_ledger.append({"transaction_id": tx, "file_amount": amount})
        elif abs((ledger[tx] or 0) - amount) > tolerance:
            mismatched.append({"transaction_id": tx, "file_amount": amount, "ledger_amount": ledger[tx]})
        else:
            matched.append(tx)
    missing_in_file = [{"transaction_id": tx, "ledger_amount": v} for tx, v in ledger.items() if tx not in seen]
    ledger_total = sum(v or 0 for v in ledger.values())
    return {
        "file_rows": len(seen), "matched": len(matched),
        "mismatched": mismatched, "missing_in_ledger": missing_in_ledger, "missing_in_file": missing_in_file,
        "file_total": round(file_total, 2), "ledger_total": round(ledger_total, 2),
        "difference": round(file_total - ledger_total, 2),
        "status": "ok" if not (mismatched or missing_in_ledger or missing_in_file) else "divergent",
    }


def periods_overlap(a_start: datetime, a_end: datetime, b_start: datetime, b_end: datetime) -> bool:
    return a_start < b_end and b_start < a_end


def csv_escape(value: Optional[Any]) -> str:
    text = "" if value is None else str(value)
    # Evita injeção de fórmula ao abrir no Excel/Sheets.
    if text[:1] in ("=", "+", "-", "@") and not text.replace(".", "", 1).lstrip("-").isdigit():
        text = "'" + text
    if any(c in text for c in (",", '"', "\n", ";")):
        text = '"' + text.replace('"', '""') + '"'
    return text
