"""Plan 029: filtered total + paginate-after-filter + no ghost rows.

Seeds BacktestRun rows directly (no background backtests scheduled) with
test029_* strategy names and deletes exactly those ids afterwards — user
rows are never touched.
"""

import pytest
from fastapi.testclient import TestClient

from backend.database import BacktestRun as DBRun
from backend.database import SessionLocal
from backend.main import app

client = TestClient(app)

SPECS = [
    ("test029_alpha_0", 0.1),
    ("test029_alpha_1", 0.2),
    ("test029_beta_0", 0.3),
    ("test029_beta_1", 0.4),
    ("test029_beta_2", 0.5),
]


@pytest.fixture()
def seeded_runs():
    db = SessionLocal()
    ids = []
    try:
        for name, tr in SPECS:
            row = DBRun(
                strategy_id=None,
                config_json={"strategy_name": name, "start": "2020-01-01", "end": "2020-12-31"},
                stats_json={"cagr": tr, "total_return": tr, "max_drawdown": -0.1, "daily_sharpe": 1.0, "daily_sortino": 1.0},
            )
            db.add(row)
            db.flush()
            ids.append(row.id)
        db.commit()
        yield ids
    finally:
        db.query(DBRun).filter(DBRun.id.in_(ids)).delete(synchronize_session=False)
        db.commit()
        db.close()


def test_search_total_matches_filtered_set(seeded_runs):
    r = client.get("/api/bt/runs?search=test029_alpha")
    assert r.status_code == 200
    j = r.json()
    assert j["total"] == 2
    assert {row["id"] for row in j["data"]} == set(seeded_runs[:2])


def test_filtered_pagination_windows_are_disjoint(seeded_runs):
    seen = []
    for offset, size in ((0, 2), (2, 2), (4, 1)):
        r = client.get(f"/api/bt/runs?search=test029&limit=2&offset={offset}")
        assert r.status_code == 200
        j = r.json()
        assert j["total"] == 5
        assert len(j["data"]) == size
        seen.extend(row["id"] for row in j["data"])
    assert sorted(seen) == sorted(seeded_runs)


def test_sort_numeric_desc_with_correct_total(seeded_runs):
    r = client.get("/api/bt/runs?search=test029&sort_by=total_return&sort_dir=desc")
    assert r.status_code == 200
    j = r.json()
    assert j["total"] == 5
    assert [row["total_return"] for row in j["data"]] == [0.5, 0.4, 0.3, 0.2, 0.1]


def _tree(name):
    return {"name": name, "root": {"name": name, "type": "Strategy", "algos": [], "children": []}, "version": 1}


def test_no_ghost_row_on_reject():
    before = client.get("/api/bt/runs?limit=1").json()["total"]
    r = client.post("/api/bt/backtest", json={"tree": _tree("test_029_ghost")})
    assert r.status_code == 422
    r = client.post("/api/bt/backtest", json={"tree": _tree("test_029_ghost"), "price_source_id": 99999})
    assert r.status_code == 404
    after = client.get("/api/bt/runs?limit=1").json()["total"]
    assert after == before
    assert client.get("/api/bt/runs?search=test_029_ghost").json()["total"] == 0
