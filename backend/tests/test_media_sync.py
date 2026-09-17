from media_sync import account_id, merge_insights, to_float


def test_conta_e_numeros():
    assert account_id({"ad_account_id": "123"}) == "act_123"
    assert account_id({"ad_account_id": "act_123"}) == "act_123"
    assert account_id({}) is None
    assert to_float("12.5") == 12.5 and to_float(None) == 0.0 and to_float("x") == 0.0


def test_junta_campanha_com_investimento():
    campaigns = [{"id": "c1", "name": "CBO 03", "status": "ACTIVE", "daily_budget": "5000"},
                 {"id": "c2", "name": "Retarget", "status": "PAUSED"}]
    insights = [
        {"campaign_id": "c1", "spend": "10.50", "impressions": "1000", "clicks": "40", "date_start": "2026-09-16"},
        {"campaign_id": "c1", "spend": "9.50", "impressions": "900", "clicks": "35", "date_start": "2026-09-17"},
        {"campaign_id": "sem-campanha"},
    ]
    merged = {row["external_id"]: row for row in merge_insights(campaigns, insights)}
    assert merged["c1"]["spend"] == 20.0 and merged["c1"]["clicks"] == 75
    assert merged["c1"]["budget"] == 50.0 and merged["c1"]["status"] == "active"
    assert [d["date"] for d in merged["c1"]["daily"]] == ["2026-09-16", "2026-09-17"]
    # Campanha sem insight entra zerada, senão ela sumiria da tela.
    assert merged["c2"]["spend"] == 0 and merged["c2"]["status"] == "paused" and merged["c2"]["daily"] == []
