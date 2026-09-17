import random

from automation_engine import advance, menu_choice, simulate, validate


def node(id, kind, **config):
    return {"id": id, "data": {"kind": kind, "label": id, "config": config}}


def edge(s, t, h=None):
    return {"source": s, "target": t, "sourceHandle": h}


GRAPH = {
    "nodes": [
        node("t", "trigger"),
        node("oi", "message", text="Oi {primeiro_nome}!"),
        node("c", "condition", field="message", operator="contains", value="bônus"),
        node("menu", "menu", text="Quer o quê?", options=["Sinais", "Suporte"]),
        node("w", "wait", minutes=10),
        node("fim", "message", text="Até logo"),
        node("h", "handoff"),
        node("tg", "tags", add=["VIP"]),
    ],
    "edges": [
        edge("t", "oi"), edge("oi", "c"),
        edge("c", "menu", "yes"), edge("c", "w", "no"),
        edge("menu", "tg", "opt-0"), edge("menu", "h", "opt-1"), edge("menu", "fim", "other"),
        edge("w", "fim"),
    ],
}


def test_publicavel():
    assert validate(GRAPH) == []
    assert "exatamente um bloco de início" in validate({"nodes": [], "edges": []})[0]
    bad = {"nodes": [node("t", "trigger"), node("m", "message", text="")], "edges": [edge("t", "m")]}
    assert any("mensagem vazia" in p for p in validate(bad))


def test_caminho_do_menu_com_resposta():
    ctx = {"message": "quero bônus", "player_name": "Ana Souza"}
    r = advance(GRAPH, "t", ctx)
    assert r["status"] == "waiting" and r["pause"] == {"kind": "reply"} and r["current"] == "menu"
    assert [e["text"] for e in r["effects"] if e["type"] == "send"] == ["Oi Ana!", "Quer o quê?\n1. Sinais\n2. Suporte"]
    r2 = advance(GRAPH, "menu", ctx, resume_reply="1")
    assert r2["status"] == "completed"
    assert {"type": "tags", "node": "tg", "add": ["vip"], "remove": []} in r2["effects"]


def test_espera_pausa_e_continua():
    r = advance(GRAPH, "t", {"message": "oi"})
    assert r["status"] == "waiting" and r["pause"] == {"kind": "delay", "minutes": 10.0} and r["current"] == "fim"
    r2 = advance(GRAPH, r["current"], {})
    assert r2["status"] == "completed" and r2["effects"][0]["text"] == "Até logo"


def test_menu_por_texto_e_fallback():
    cfg = {"options": ["Sinais", "Suporte"]}
    assert menu_choice(cfg, "suporte") == "opt-1"
    assert menu_choice(cfg, "2 por favor") == "opt-1"
    assert menu_choice(cfg, "9") == "other"


def test_ciclo_nao_trava():
    loop = {"nodes": [node("t", "trigger"), node("a", "tags", add=["x"])], "edges": [edge("t", "a"), edge("a", "a")]}
    r = advance(loop, "t", {})
    assert r["status"] == "failed" and "ciclo" in r["error"]


def test_simulacao_completa():
    transcript = simulate(GRAPH, {"message": "bônus", "player_name": "Bia"}, ["2"], rnd=random.Random(1))
    kinds = [e["type"] for e in transcript]
    assert kinds[-1] == "end" and transcript[-1]["status"] == "completed"
    assert "handoff" in kinds and "reply" in kinds
