import random

from attribution import (
    build_destination, device_from_ua, is_start_command, match_rule,
    membership_change, pick_variant, start_param,
)


def test_click_id_chega_ao_bot():
    assert build_destination("https://t.me/MeuBot", "abc123") == "https://t.me/MeuBot?start=abc123"
    # start já definido pelo operador é respeitado
    assert build_destination("https://t.me/MeuBot?start=vip", "abc") == "https://t.me/MeuBot?start=vip"
    # placeholder explícito
    assert build_destination("https://casa.com/?cid={click_id}", "x9") == "https://casa.com/?cid=x9"
    # sem placeholder, outro destino fica intacto
    assert build_destination("https://casa.com/cadastro", "x9") == "https://casa.com/cadastro"


def test_start_param():
    assert start_param("/start abc_1-2") == "abc_1-2"
    assert start_param("/start@MeuBot abc") == "abc"
    assert start_param("/start") is None
    assert start_param("/starting abc") is None
    assert start_param("/start " + "a" * 65) is None
    assert start_param("/start a b") is None
    assert is_start_command("/start@MeuBot")
    assert not is_start_command("oi /start")
    assert not is_start_command("   ")
    assert not is_start_command(None)


def test_regras_em_ordem_e_hora_na_virada():
    rules = [
        {"type": "country", "values": ["pt"], "destination": "https://pt"},
        {"type": "device", "values": ["mobile"], "destination": "https://m"},
        {"type": "hour", "values": ["22-2"], "destination": "https://noite"},
    ]
    assert match_rule(rules, {"country": "PT", "device": "mobile", "hour": 12})["destination"] == "https://pt"
    assert match_rule(rules, {"country": "BR", "device": "mobile", "hour": 12})["destination"] == "https://m"
    assert match_rule(rules, {"country": "BR", "device": "desktop", "hour": 1})["destination"] == "https://noite"
    assert match_rule(rules, {"country": "BR", "device": "desktop", "hour": 12}) is None
    assert device_from_ua("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0)") == "mobile"
    assert device_from_ua(None) == "desktop"


def test_variante_respeita_peso():
    variants = [{"destination": "a", "weight": 0}, {"destination": "b", "weight": 3}, {"destination": "c", "weight": 1}]
    rnd = random.Random(7)
    picks = [pick_variant(variants, rnd)["destination"] for _ in range(4000)]
    assert "a" not in picks
    assert 0.70 < picks.count("b") / len(picks) < 0.80
    assert pick_variant([{"destination": "x", "weight": 0}]) is None


def test_entrada_e_saida_do_canal():
    join = {"old_chat_member": {"status": "left"}, "new_chat_member": {"status": "member"}}
    leave = {"old_chat_member": {"status": "member"}, "new_chat_member": {"status": "kicked"}}
    promo = {"old_chat_member": {"status": "member"}, "new_chat_member": {"status": "administrator"}}
    restricted_out = {"old_chat_member": {"status": "member"}, "new_chat_member": {"status": "restricted", "is_member": False}}
    assert membership_change(join) == "channel_join"
    assert membership_change(leave) == "channel_leave"
    assert membership_change(promo) is None
    assert membership_change(restricted_out) == "channel_leave"
