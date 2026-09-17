from datetime import datetime, timezone

from admin_logic import (dsr_deadline, estimate_cost, estimate_tokens, incident_duration, invoice_lines,
                         month_range, next_version, plan_changes, slo_state, uptime, usage_status)


def test_mes_e_uso():
    start, end, label = month_range("2026-12")
    assert (start.month, end.month, end.year, label) == (12, 1, 2027, "2026-12")
    assert usage_status(10, None)["state"] == "unlimited"
    assert usage_status(90, 100)["state"] == "warning" and usage_status(90, 100)["percent"] == 90.0
    assert usage_status(120, 100)["state"] == "over"
    assert usage_status(10, 100)["state"] == "ok"


def test_fatura_com_excedente():
    plan = {"name": "Pro", "price": 500, "currency": "BRL", "overage": {"messages": 0.05}}
    usage = {"messages": {"used": 12000, "limit": 10000}, "events": {"used": 50, "limit": 1000}}
    invoice = invoice_lines(plan, usage)
    assert invoice["total"] == 600.0 and len(invoice["lines"]) == 2
    assert invoice["lines"][1]["quantity"] == 2000


def test_versao_e_mudancas_do_plano():
    assert next_version([{"version": 1}, {"version": 3}]) == 4
    changes = plan_changes({"price": 100, "limits": {"messages": 1000}, "features": ["inbox"]},
                           {"price": 150, "limits": {"messages": 5000}, "features": ["inbox", "ia"]})
    assert any("preço" in c for c in changes) and any("liberou ia" in c for c in changes)
    assert plan_changes({"price": 100}, {"price": 100}) == []


def test_slo_incidente_e_prazo():
    assert uptime([]) == {"uptime": None, "samples": 0, "down": 0}
    assert uptime([{"ok": True}] * 99 + [{"ok": False}])["uptime"] == 99.0
    assert slo_state(99.9, 99.5) == "ok" and slo_state(99.2, 99.5) == "at_risk" and slo_state(90, 99.5) == "breached"
    started = datetime(2026, 9, 17, 10, 0, tzinfo=timezone.utc)
    assert incident_duration({"started_at": started, "resolved_at": datetime(2026, 9, 17, 10, 45, tzinfo=timezone.utc)}) == 45
    assert dsr_deadline(started).day == 2  # 15 dias depois
    assert estimate_cost("claude-haiku-4-5-20251001", estimate_tokens("a" * 4000)) > 0
