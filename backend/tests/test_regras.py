"""Regras puras que alimentam telas e alertas. Não tocam o banco."""
import os

os.environ.setdefault("MONGO_URL", "mongodb://localhost:27017")
os.environ.setdefault("DB_NAME", "traak_test")
os.environ.setdefault("JWT_SECRET", "test")

from messaging import ftd_dropped  # noqa: E402
from attribution import normalize_source  # noqa: E402


def test_normalize_source_aliases():
    assert normalize_source("Facebook") == "meta"
    assert normalize_source(" instagram ") == "meta"
    assert normalize_source("TT") == "tiktok"
    assert normalize_source("youtube") == "google"
    assert normalize_source(None) == "direct"
    assert normalize_source("") == "direct"
    assert normalize_source("taboola") == "taboola"


def test_ftd_drop_needs_volume_and_real_fall():
    # média 10/dia, 4 nas últimas 24h → caiu mais da metade
    assert ftd_dropped(last_day=4, previous_week=70)
    # média 10/dia, 5 → exatamente metade não é queda
    assert not ftd_dropped(last_day=5, previous_week=70)
    # média 2/dia: volume baixo demais para alertar, mesmo com zero
    assert not ftd_dropped(last_day=0, previous_week=14)


def test_mongo_devolve_datas_com_fuso():
    from database import client
    assert client.codec_options.tz_aware
