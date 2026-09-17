from datetime import datetime, timedelta, timezone

import pytest

from segments import SegmentError, is_opt_out, segment_query

NOW = datetime(2026, 9, 17, tzinfo=timezone.utc)


def test_consulta_com_e_ou():
    q = segment_query("ws", {"has_ftd": {"op": "igual", "value": "false"},
                             "total_deposits": {"op": "entre", "value": "100 a 500"}}, "and", NOW)
    assert q["workspace_id"] == "ws" and q["blocked"] == {"$ne": True}
    assert {"has_ftd": {"$ne": True}} in q["$and"]
    assert {"total_deposits": {"$gte": 100.0, "$lte": 500.0}} in q["$and"]
    q2 = segment_query("ws", {"origin": {"op": "contém", "value": "tele(gram"}}, "or", NOW)
    assert q2["$or"] == [{"origin": {"$regex": "tele\(gram", "$options": "i"}}]


def test_dias_e_fonte():
    q = segment_query("ws", {"days_since_click": {"op": "maior_que", "value": "7"},
                             "source": {"op": "igual", "value": "Facebook"}}, "and", NOW)
    assert {"created_at": {"$lt": NOW - timedelta(days=7)}} in q["$and"]
    assert "facebook" in q["$and"][1]["source"]["$in"] and "meta" in q["$and"][1]["source"]["$in"]


def test_erros_claros():
    with pytest.raises(SegmentError):
        segment_query("ws", {"total_deposits": {"op": "maior_que", "value": "muito"}})
    with pytest.raises(SegmentError):
        segment_query("ws", {"inventado": {"op": "igual", "value": "x"}})
    with pytest.raises(SegmentError):
        segment_query("ws", {"total_deposits": {"op": "entre", "value": "100"}})


def test_opt_out():
    assert is_opt_out("PARE") and is_opt_out(" sair! ") and not is_opt_out("não quero parar agora")
