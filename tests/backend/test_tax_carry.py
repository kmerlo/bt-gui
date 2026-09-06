"""Tassazione + zainetto fiscale: FIFO, scadenza 4 anni, dividendi mai compensati."""
import pandas as pd

from backend.services.tax import _norm_trades, apply_tax, fifo_realized_trades


def _eq(dates):
    idx = pd.to_datetime(dates)
    return pd.Series([100000.0] * len(idx), index=idx)


def _raw(dates, tickers=("AAA",)):
    n = len(dates)
    ticks = list(tickers) * ((n // len(tickers)) + 1)
    return pd.DataFrame({"date": pd.to_datetime(dates), "ticker": ticks[:n],
                         "qty": [0] * n, "price": [0] * n})


def test_zainetto_compensa_gain_fino_a_concorrenza():
    # loss 1000 -> gain 600 tax 0 (carry 400) -> gain 600: taxable 200 x 26% = 52
    dates = ["2026-02-05", "2026-04-05", "2026-06-05"]
    real = pd.DataFrame({"date": pd.to_datetime(dates), "ticker": ["AAA"] * 3,
                         "qty": [0, 0, 0], "price": [0, 0, 0], "pnl": [-1000.0, 600.0, 600.0]})
    res = apply_tax(_eq(dates), real, _raw(dates), None, None, {}, {}, 26.0, 26.0, True, 4)
    assert res["summary"]["tax_paid_gains"] == 52.0
    assert res["summary"]["tax_loss_carry_remaining"] == 0.0


def test_zainetto_off_ignora_perdite():
    dates = ["2026-02-05", "2026-04-05"]
    real = pd.DataFrame({"date": pd.to_datetime(dates), "ticker": ["AAA"] * 2,
                         "qty": [0, 0], "price": [0, 0], "pnl": [-1000.0, 600.0]})
    res = apply_tax(_eq(dates), real, _raw(dates), None, None, {}, {}, 26.0, 26.0, False, 4)
    assert res["summary"]["tax_paid_gains"] == 156.0
    assert res["summary"]["tax_loss_carry_remaining"] == 0.0


def test_carry_scade_31_12_quarto_anno():
    # loss 7/9/2026 usabile fino al 31/12/2030: gain 2030 compensa, gain 2031 paga pieno
    dates = ["2026-09-07", "2030-12-20", "2031-03-15"]
    real = pd.DataFrame({"date": pd.to_datetime(dates), "ticker": ["AAA"] * 3,
                         "qty": [0, 0, 0], "price": [0, 0, 0], "pnl": [-1000.0, 600.0, 600.0]})
    res = apply_tax(_eq(dates), real, _raw(dates), None, None, {}, {}, 26.0, 26.0, True, 4)
    assert res["summary"]["tax_paid_gains"] == 156.0
    assert res["summary"]["tax_carry_expired_unused"] == 400.0
    assert res["summary"]["tax_loss_carry_remaining"] == 0.0


def test_dividendi_tassati_mai_compensati():
    dates = ["2026-01-05", "2026-02-05", "2026-03-05"]
    real = pd.DataFrame({"date": [pd.to_datetime(dates[0])], "ticker": ["AAA"],
                         "qty": [0], "price": [0], "pnl": [-500.0]})
    div = pd.DataFrame({"AAA": [0.0, 1000.0, 0.0]}, index=pd.to_datetime(dates))
    res = apply_tax(_eq(dates), real, _raw(dates[:1]), None, div, {}, {}, 26.0, 26.0, True, 4)
    assert res["summary"]["tax_paid_dividends"] == 260.0
    assert res["summary"]["tax_loss_carry_remaining"] == 500.0
    assert float(res["equity_net"].iloc[-1]) == 100000.0 + 1000.0 - 260.0


def test_aliquota_per_ticker():
    dates = ["2026-02-05"]
    real = pd.DataFrame({"date": pd.to_datetime(dates), "ticker": ["BTP"],
                         "qty": [0], "price": [0], "pnl": [1000.0]})
    res = apply_tax(_eq(dates), real, _raw(dates), None, None,
                    {"BTP": 12.5}, {}, 26.0, 26.0, False, 4)
    assert res["summary"]["tax_paid_gains"] == 125.0


def test_fifo_pnl_da_transactions_bt():
    tx = pd.DataFrame({
        "Security": ["AAA"] * 6,
        "Date": pd.to_datetime(["2026-01-05", "2026-02-05", "2026-03-05",
                                "2026-04-05", "2026-05-05", "2026-06-05"]),
        "quantity": [100, -100, 100, -100, 100, -100],
        "price": [20.0, 10.0, 10.0, 16.0, 10.0, 16.0],
    })
    real = fifo_realized_trades(tx)
    assert [round(x) for x in real["pnl"]] == [-1000, 600, 600]
    raw = _norm_trades(tx)
    assert len(raw) == 6


def test_backtest_con_tax_salva_chiavi_fiscali():
    """Integrazione API: run con tax attiva → stats con chiavi tax_* (test DB da conftest)."""
    import io
    import time
    import uuid

    import numpy as np
    from fastapi.testclient import TestClient

    from backend.main import app

    client = TestClient(app)
    uid = uuid.uuid4().hex[:6]
    idx = pd.date_range("2020-01-02", periods=30, freq="B")
    np.random.seed(0)
    df = pd.DataFrame({"AAPL": 100 + np.cumsum(np.random.randn(30) * 0.5 + 0.1)}, index=idx)
    buf = io.BytesIO()
    df.to_csv(buf)
    buf.seek(0)
    r = client.post(f"/api/bt/data-sources/upload?name=test_tax_{uid}&type=price",
                    files={"file": ("prices.csv", buf.getvalue(), "text/csv")})
    assert r.status_code == 201, r.text
    price_id = r.json()["id"]
    tree = {
        "name": f"test_tax_{uid}",
        "root": {
            "name": "root", "type": "Strategy",
            "algos": [{"class_name": "RunMonthly"}, {"class_name": "SelectAll"},
                      {"class_name": "WeighEqually"}, {"class_name": "Rebalance"}],
            "children": [{"name": "AAPL", "type": "Security"}],
        },
        "version": 1,
    }
    req = {"tree": tree, "price_source_id": price_id,
           "config": {"initial_capital": 100000, "integer_positions": False,
                      "tax": {"enabled": True, "default_gain_rate": 26.0,
                              "default_div_rate": 26.0, "use_loss_carry": True}}}
    r = client.post("/api/bt/backtest", json=req)
    assert r.status_code == 201, r.text
    run_id = r.json()["id"]
    stats = None
    for _ in range(50):
        time.sleep(0.2)
        gr = client.get(f"/api/bt/runs/{run_id}")
        assert gr.status_code == 200
        stats = gr.json().get("stats")
        if stats and "cagr" in stats:
            break
        if stats and "error" in stats:
            assert False, f"run error: {stats}"
    assert stats is not None, "run did not finish"
    assert stats.get("tax_enabled") is True
    for k in ("tax_paid_gains", "tax_paid_total", "tax_loss_carry_remaining",
              "tax_carry_expired_unused", "gross_total_return"):
        assert k in stats, f"missing {k}"
    assert stats["tax_paid_total"] >= 0
