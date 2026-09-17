import os

os.environ.setdefault("PUBLIC_BACKEND_URL", "https://app.exemplo.com")

from domains_check import PURPOSE_LABELS, STATUS_LABELS, expected_records, tracking_host, verify_token
from webhooks_out import EVENTS, sign, wants


def test_registros_do_dominio():
    records = expected_records("trk.cliente.com", "ws1")
    assert tracking_host() == "app.exemplo.com"
    cname, txt = records
    assert cname["type"] == "CNAME" and cname["name"] == "trk.cliente.com" and cname["value"] == "app.exemplo.com"
    assert txt["name"] == "_trak.trk.cliente.com" and txt["value"].startswith("trak-verify=")
    # O token é estável por workspace e domínio, senão o cliente teria de refazer o DNS.
    assert verify_token("ws1", "trk.cliente.com") == verify_token("ws1", "trk.cliente.com")
    assert verify_token("ws2", "trk.cliente.com") != verify_token("ws1", "trk.cliente.com")
    assert STATUS_LABELS["pending_dns"] == "Aguardando DNS" and PURPOSE_LABELS["tracking"] == "Rastreamento"


def test_filtro_e_assinatura_do_webhook():
    assert wants({"config": {}}, "event.ftd")                       # sem escolha = tudo
    assert wants({"config": {"events": ["event.ftd"]}}, "event.ftd")
    assert not wants({"config": {"events": ["event.ftd"]}}, "message.received")
    assert set(EVENTS) >= {"lead.created", "event.ftd", "message.received"}
    assert sign(b"corpo", "segredo") == sign(b"corpo", "segredo")
    assert sign(b"corpo", "segredo") != sign(b"corpo", "outro")
