from datetime import datetime, timezone
from zoneinfo import ZoneInfo

from prove_logic import csv_escape, in_send_window, next_run, policy_errors, reconcile, row_metrics

SP = ZoneInfo("America/Sao_Paulo")


def test_conciliacao():
    r = reconcile(
        [{"transaction_id": "a", "amount": "100,00"}, {"transaction_id": "b", "amount": 50},
         {"transaction_id": "x", "amount": 10}, {"transaction_id": "a", "amount": 100}],
        {"a": 100.0, "b": 49.0, "c": 20.0},
    )
    assert r["matched"] == 1 and r["file_rows"] == 3
    assert r["mismatched"] == [{"transaction_id": "b", "file_amount": 50.0, "ledger_amount": 49.0}]
    assert [m["transaction_id"] for m in r["missing_in_ledger"]] == ["x"]
    assert [m["transaction_id"] for m in r["missing_in_file"]] == ["c"]
    assert r["status"] == "divergent" and r["difference"] == -9.0


def test_proxima_execucao_no_fuso():
    after = datetime(2026, 9, 17, 12, 0, tzinfo=timezone.utc)  # 09:00 em SP
    assert next_run({"frequency": "daily", "hour": 8}, after, SP) == datetime(2026, 9, 18, 11, 0, tzinfo=timezone.utc)
    assert next_run({"frequency": "daily", "hour": 10}, after, SP) == datetime(2026, 9, 17, 13, 0, tzinfo=timezone.utc)
    weekly = next_run({"frequency": "weekly", "hour": 8, "weekday": 0}, after, SP)  # segunda
    assert weekly.astimezone(SP).weekday() == 0 and weekly > after
    dec = next_run({"frequency": "monthly", "hour": 8, "day": 5}, datetime(2026, 12, 20, tzinfo=timezone.utc), SP)
    assert (dec.astimezone(SP).year, dec.astimezone(SP).month, dec.astimezone(SP).day) == (2027, 1, 5)


def test_janela_e_politica():
    assert in_send_window(8, 8, 20) and not in_send_window(20, 8, 20)
    assert in_send_window(23, 22, 6) and in_send_window(2, 22, 6) and not in_send_window(12, 22, 6)
    assert policy_errors("send_window", {"start_hour": 8, "end_hour": 25})
    assert policy_errors("dispatch_approval", {"min_recipients": "500"}) == []
    assert policy_errors("inventada", {})


def test_metricas_e_csv():
    m = row_metrics({"ftd": {"count": 2, "value": 100}, "deposit": {"count": 1, "value": 50}, "withdrawal": {"value": 30}})
    assert m["ftds"] == 2 and m["deposits"] == 150 and m["net_deposits"] == 120
    assert csv_escape("=HYPERLINK(1)") == "'=HYPERLINK(1)"
    assert csv_escape("-12.5") == "-12.5"
    assert csv_escape('a,"b"') == '"a,""b"""'
