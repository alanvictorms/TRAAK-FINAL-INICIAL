from datetime import datetime, timedelta, timezone

import pytest

from analytics import buckets, funnel_steps, pct_change, ratio, resolve_period, response_minutes, workspace_tz

SP = workspace_tz("America/Sao_Paulo")


def test_periodos_de_mesmo_tamanho():
    now = datetime(2026, 9, 17, 12, tzinfo=timezone.utc)
    prev, start, end = resolve_period("7d", now)
    assert end - start == start - prev == timedelta(days=7)
    with pytest.raises(ValueError):
        resolve_period("1y", now)


def test_buckets_diarios_no_fuso_do_workspace():
    # 03:00 UTC = meia-noite em São Paulo
    start = datetime(2026, 9, 10, 3, tzinfo=timezone.utc)
    end = datetime(2026, 9, 13, 3, tzinfo=timezone.utc)
    days = buckets(start, end, "day", SP)
    assert [d.isoformat() for d in days] == [
        "2026-09-10T03:00:00+00:00", "2026-09-11T03:00:00+00:00", "2026-09-12T03:00:00+00:00",
    ]


def test_buckets_semana_e_mes():
    start = datetime(2026, 9, 17, 15, tzinfo=timezone.utc)  # quinta
    weeks = buckets(start, start + timedelta(days=14), "week", SP)
    assert weeks[0].astimezone(SP).weekday() == 0
    months = buckets(datetime(2026, 1, 31, 12, tzinfo=timezone.utc), datetime(2026, 4, 2, tzinfo=timezone.utc), "month", SP)
    assert [m.astimezone(SP).month for m in months] == [1, 2, 3, 4]
    with pytest.raises(ValueError):
        buckets(start - timedelta(days=90), start, "hour", SP)


def test_variacao_sem_base_nao_inventa():
    assert pct_change(10, 0) is None
    assert pct_change(15, 10) == 50.0
    assert ratio(1, 0) is None
    assert ratio(25, 100, pct=True) == 25.0


def test_funil():
    steps = funnel_steps({"click": 100, "bot_start": 40, "channel_join": 20, "register": 10, "ftd": 5},
                         {"click": 50, "ftd": 0})
    assert [s["step_rate"] for s in steps] == [None, 40.0, 50.0, 50.0, 50.0]
    assert steps[-1]["total_rate"] == 5.0
    assert steps[0]["change"] == 100.0
    assert steps[-1]["change"] is None


def test_tempo_de_primeira_resposta():
    t = datetime(2026, 9, 17, tzinfo=timezone.utc)
    stats = response_minutes([(t, t + timedelta(minutes=10)), (t, t + timedelta(minutes=2)), (t, t + timedelta(minutes=30)), (t, None)])
    assert stats == {"avg": 14.0, "median": 10.0, "count": 3}
    assert response_minutes([])["avg"] is None
