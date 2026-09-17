from datetime import datetime, timedelta, timezone

from ai_agent import agent_errors, blocked, followup_schedule, handoff_reason, in_hours, render, top_words, trigger_reason

BASE = {"name": "Ana", "prompt": "Oi {{nome}}", "mode": "suggested", "model": "claude-haiku-4-5-20251001",
        "hours": {"enabled": True, "days": ["seg"], "start": "09:00", "end": "18:00"},
        "triggers": {"new_lead": True}, "filters": {}, "handoff": {}}


def ctx(**kw):
    base = {"text": "", "local": datetime(2026, 9, 14, 10, 0), "is_new_lead": False, "tags": [], "assigned_to": None}
    base.update(kw)
    return base


def test_validacao():
    assert agent_errors(BASE) == []
    assert agent_errors({**BASE, "name": " "})
    assert agent_errors({**BASE, "model": "inventado"})
    assert agent_errors({**BASE, "hours": {"enabled": True, "days": ["seg"], "start": "25:00", "end": "18:00"}})
    assert agent_errors({**BASE, "triggers": {"keywords_enabled": True, "keywords": []}})


def test_horario_comercial():
    segunda_10h = datetime(2026, 9, 14, 10, 0)
    assert in_hours(segunda_10h, BASE["hours"])
    assert not in_hours(datetime(2026, 9, 14, 19, 0), BASE["hours"])
    assert not in_hours(datetime(2026, 9, 13, 10, 0), BASE["hours"])  # domingo
    assert in_hours(segunda_10h, {"enabled": False})
    assert in_hours(datetime(2026, 9, 14, 23, 0), {"enabled": True, "days": ["seg"], "start": "22:00", "end": "06:00"})


def test_gatilhos_e_filtros():
    assert trigger_reason(BASE, ctx(is_new_lead=True)) == "lead novo"
    kw = {**BASE, "triggers": {"keywords_enabled": True, "keywords": ["Orçamento"]}}
    assert trigger_reason(kw, ctx(text="qual o ORÇAMENTO?")) == "palavra-chave"
    assert trigger_reason(kw, ctx(text="bom dia")) is None
    fora = {**BASE, "hours": {**BASE["hours"], "outside": "silent"}}
    assert trigger_reason(fora, ctx(is_new_lead=True, local=datetime(2026, 9, 14, 21, 0))) is None
    assert trigger_reason({**BASE, "triggers": {}}, ctx(text="oi", local=datetime(2026, 9, 14, 21, 0))) == "fora do horário humano"
    assert blocked({**BASE, "filters": {"skip_assigned": True}}, ctx(assigned_to="u1")) == "lead já tem operador"
    assert blocked({**BASE, "filters": {"excluded_tags": ["VIP"]}}, ctx(tags=["vip"])) == "lead tem tag excluída"
    assert blocked({**BASE, "handoff": {"max_replies": 2}}, ctx(replies_sent=2)) == "limite de respostas da conversa"
    assert blocked(BASE, ctx()) is None


def test_handoff_variaveis_followup():
    agent = {**BASE, "handoff": {"keywords": ["humano"]}}
    assert handoff_reason(agent, "quero falar com um HUMANO") == "pedido do cliente"
    assert handoff_reason(agent, "tudo certo") is None
    assert render("Oi {{primeiro_nome}}, etapa {{etapa}}", {"name": "Ana Lima"}) == "Oi Ana, etapa sem etapa"
    now = datetime(2026, 9, 14, 10, 0, tzinfo=timezone.utc)
    steps = followup_schedule({"followups": [{"after_min": 60, "tone": "leve"}, {"after_min": 30}]}, now)
    assert [s["at"] for s in steps] == [now + timedelta(minutes=60), now + timedelta(minutes=90)]
    assert [t["term"] for t in top_words(["quero saber do bônus", "o bônus chegou?"], 2)][0] == "bônus"
