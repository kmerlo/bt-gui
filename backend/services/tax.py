from __future__ import annotations

from collections import deque
from typing import Any

import pandas as pd

# ponytail: post-process fiscale puro — niente bt, niente DB, testabile in isolamento.
# Contratti:
# - trades bt (quantity/price) -> P&L realizzato ricostruito FIFO per ticker.
# - coupon: serie per-unit formato bt; cash = per_unit x posizione ricostruita.
#   Il lordo resta in equity via CouponPayingSecurity (no gross-up, no doppio conteggio).
# - dividendi: CSV manuale, valori = cash TOTALE accreditato; gross-up qui (bt li ignora).
# - dividendi/coupon sempre tassati, MAI compensabili con lo zainetto (normativa IT).


def _norm_trades(tx: pd.DataFrame) -> pd.DataFrame:
    """Ritorna colonne [date, ticker, qty, price] ordinate per data."""
    df = tx.reset_index() if not isinstance(tx.index, pd.RangeIndex) else tx.copy()
    cols = {str(c).lower(): c for c in df.columns}
    date_c = cols.get("date")
    tick_c = cols.get("security", cols.get("ticker", cols.get("symbol")))
    qty_c = cols.get("quantity", cols.get("qty"))
    price_c = cols.get("price")
    if date_c is None or tick_c is None or qty_c is None or price_c is None:
        raise ValueError(f"transactions senza colonne attese, trovate: {list(df.columns)}")
    out = pd.DataFrame(
        {
            "date": pd.to_datetime(df[date_c]),
            "ticker": df[tick_c].astype(str).str.upper(),
            "qty": pd.to_numeric(df[qty_c], errors="coerce").fillna(0.0),  # type: ignore[union-attr]
            "price": pd.to_numeric(df[price_c], errors="coerce").fillna(0.0),  # type: ignore[union-attr]
        }
    )
    return out[out["qty"] != 0].sort_values("date").reset_index(drop=True)


def fifo_realized_trades(tx: pd.DataFrame) -> pd.DataFrame:
    """P&L realizzato per chiusura, FIFO per ticker. Righe: date, ticker, qty, price, pnl."""
    trades = _norm_trades(tx)
    rows: list[dict] = []
    lots: dict[str, deque] = {}
    for r in trades.itertuples():
        q: float = float(r.qty)
        p: float = float(r.price)
        qlots = lots.setdefault(r.ticker, deque())
        net = sum(lq for lq, _ in qlots)
        if net == 0 or (net > 0) == (q > 0):
            qlots.append([q, p])
            continue
        # chiusura (parziale o flip): abbina ai lotti più vecchi
        remain = abs(q)
        direction = 1.0 if net > 0 else -1.0  # +1 chiude long, -1 chiude short
        while remain > 1e-12 and qlots and (sum(lq for lq, _ in qlots) > 0) == (net > 0):
            lq, lp = qlots[0]
            closed = min(abs(lq), remain)
            rows.append({"date": r.date, "ticker": r.ticker, "qty": -closed * direction,
                         "price": p, "pnl": (p - lp) * closed * direction})
            remain -= closed
            if abs(lq) <= closed + 1e-12:
                qlots.popleft()
            else:
                qlots[0][0] = lq - closed * (1.0 if lq > 0 else -1.0)
        if remain > 1e-12:
            qlots.append([remain * (1.0 if q > 0 else -1.0), p])
    out = pd.DataFrame(rows, columns=["date", "ticker", "qty", "price", "pnl"])
    if not out.empty:
        out["date"] = pd.to_datetime(out["date"])
        out = out.sort_values("date").reset_index(drop=True)
    return out


def _upper_cols(df: pd.DataFrame | None) -> pd.DataFrame | None:
    if df is None or df.empty:
        return None
    df = df.copy()
    df.columns = [str(c).upper() for c in df.columns]
    df.index = pd.to_datetime(df.index)
    return df.sort_index()


def _positions_at(trades: pd.DataFrame, idx: pd.DatetimeIndex) -> pd.DataFrame:
    """Posizione per ticker su index equity (ffill, 0 prima del primo trade)."""
    if trades.empty:
        return pd.DataFrame(index=idx)
    piv = trades.pivot_table(index="date", columns="ticker", values="qty", aggfunc="sum").sort_index()
    return piv.cumsum().reindex(idx).ffill().fillna(0.0)


def apply_tax(
    equity: pd.Series,
    realized: pd.DataFrame,
    raw_trades: pd.DataFrame,
    coupons: pd.DataFrame | None,
    dividends: pd.DataFrame | None,
    gain_rate_of: dict[str, float],
    div_rate_of: dict[str, float],
    default_gain_rate: float,
    default_div_rate: float,
    use_loss_carry: bool,
    expiry_years: int,
) -> dict:
    """Applica tasse; ritorna equity_net, cum_tax, div_gross_cum, dettagli, summary."""
    idx = pd.DatetimeIndex(sorted(pd.to_datetime(equity.index).unique()))
    eq = pd.to_numeric(equity, errors="coerce").reindex(idx).ffill().fillna(0.0)

    coupons = _upper_cols(coupons)
    dividends = _upper_cols(dividends)
    pos = _positions_at(raw_trades, idx)

    def grate(t: str) -> float:
        return gain_rate_of.get(t, default_gain_rate) / 100.0

    def drate(t: str) -> float:
        return div_rate_of.get(t, default_div_rate) / 100.0

    # --- dividendi: gross-up + tassa alla distribuzione (mai compensati) ---
    div_gross = pd.Series(0.0, index=idx)
    div_tax = pd.Series(0.0, index=idx)
    div_events: list[dict] = []
    if dividends is not None:
        for (d, t), amt in dividends.stack().items():
            ts = pd.Timestamp(d)
            if ts not in div_gross.index:
                continue
            try:
                cash = float(amt)  # type: ignore[arg-type]
            except (TypeError, ValueError):
                continue
            if not cash > 0:
                continue
            ticker = str(t).upper()
            tax = cash * drate(ticker)
            div_gross.loc[ts] += cash
            div_tax.loc[ts] += tax
            div_events.append({"date": ts, "ticker": ticker, "cash": cash, "tax": tax})

    # --- coupon: tassa su cash = per_unit x posizione (mai compensati) ---
    coupon_tax = pd.Series(0.0, index=idx)
    coupon_events: list[dict] = []
    coupon_gross_total = 0.0
    if coupons is not None:
        for (d, t), amt in coupons.stack().items():
            ts = pd.Timestamp(d)
            if ts not in coupon_tax.index:
                continue
            try:
                per_unit = float(amt)  # type: ignore[arg-type]
            except (TypeError, ValueError):
                continue
            if not per_unit > 0:
                continue
            ticker = str(t).upper()
            held = float(pos.loc[ts, ticker]) if ticker in pos.columns else 0.0
            if not held > 0:
                continue
            cash = per_unit * held
            coupon_gross_total += cash
            tax = cash * drate(ticker)
            coupon_tax.loc[ts] += tax
            coupon_events.append({"date": ts, "ticker": ticker, "cash": cash, "tax": tax})

    # --- gain: zainetto FIFO con scadenza 31/12(anno_perdita+expiry) ---
    lots: deque = deque()  # [amount, expiry_ts]
    expired_unused = 0.0
    gain_tax = pd.Series(0.0, index=idx)
    detail: list[dict] = []
    rp = realized.sort_values("date").reset_index(drop=True) if not realized.empty else realized
    for r in rp.itertuples():
        d = pd.Timestamp(r.date)
        if d not in gain_tax.index:
            continue
        pnl = float(r.pnl)
        ticker = str(r.ticker).upper()
        if pnl < -1e-12 and use_loss_carry:
            lots.append([abs(pnl), pd.Timestamp(year=d.year + expiry_years, month=12, day=31)])
        elif pnl > 1e-12:
            taxable = pnl
            if use_loss_carry:
                while lots and lots[0][1] < d:  # usabile fino al giorno di scadenza incluso
                    expired_unused += lots.popleft()[0]
                need = pnl
                while need > 1e-12 and lots:
                    use = min(lots[0][0], need)
                    lots[0][0] -= use
                    need -= use
                    if lots[0][0] <= 1e-9:
                        lots.popleft()
                taxable = need
            tax = taxable * grate(ticker)
            gain_tax.loc[d] += tax
            detail.append({"date": d, "ticker": ticker, "pnl": pnl, "tax": tax,
                           "carry_after": sum(a for a, _ in lots)})
        else:
            detail.append({"date": d, "ticker": ticker, "pnl": pnl, "tax": 0.0,
                           "carry_after": sum(a for a, _ in lots)})

    div_gross_cum = div_gross.cumsum()
    cum_tax = (gain_tax + div_tax + coupon_tax).cumsum()
    equity_net = eq + div_gross_cum - cum_tax

    summary = {
        "tax_enabled": True,
        "tax_paid_gains": round(float(gain_tax.sum()), 2),
        "tax_paid_dividends": round(float(div_tax.sum()), 2),
        "tax_paid_coupons": round(float(coupon_tax.sum()), 2),
        "tax_paid_total": round(float(cum_tax.iloc[-1]) if len(cum_tax) else 0.0, 2),
        "tax_loss_carry_remaining": round(float(sum(a for a, _ in lots)), 2),
        "tax_carry_expired_unused": round(float(expired_unused), 2),
        "dividends_gross": round(float(div_gross.sum()), 2),
        "coupons_gross": round(coupon_gross_total, 2),
    }
    return {
        "equity_net": equity_net,
        "cum_tax": cum_tax,
        "div_gross_cum": div_gross_cum,
        "trade_detail": pd.DataFrame(detail),
        "div_events": pd.DataFrame(div_events),
        "coupon_events": pd.DataFrame(coupon_events),
        "summary": summary,
    }


def _enrich_transactions(tx_df: pd.DataFrame, detail: pd.DataFrame) -> pd.DataFrame:
    """Aggiunge realized_pnl/trade_tax/carry_after per (data, ticker), best-effort."""
    if detail.empty:
        return tx_df
    agg = detail.groupby([pd.to_datetime(detail["date"]).dt.date, detail["ticker"]], as_index=False).agg(
        realized_pnl=("pnl", "sum"), trade_tax=("tax", "sum"), carry_after=("carry_after", "last")
    )
    lookup = {(r[0], r[1]): (r[2], r[3], r[4]) for r in agg.itertuples(index=False, name=None)}
    df = tx_df.reset_index() if not isinstance(tx_df.index, pd.RangeIndex) else tx_df.copy()
    cols = {str(c).lower(): c for c in df.columns}
    date_c = cols.get("date")
    tick_c = cols.get("security", cols.get("ticker", cols.get("symbol")))
    if date_c is None or tick_c is None:
        return tx_df
    pnls: list[float] = []
    taxes: list[float] = []
    carries: list[float] = []
    for d, t in zip(pd.to_datetime(df[date_c]), df[tick_c].astype(str).str.upper(), strict=True):
        hit = lookup.get((d.date(), t), (0.0, 0.0, 0.0))
        pnls.append(hit[0])
        taxes.append(hit[1])
        carries.append(hit[2])
    df["realized_pnl"] = pnls
    df["trade_tax"] = taxes
    df["carry_after"] = carries
    return df


def compute_tax_adjustment(
    tax_cfg: Any,  # TaxConfig (Any per evitare import circolari nei test puri)
    prices: pd.Series,
    tx_df: pd.DataFrame,
    coupons_df: pd.DataFrame | None,
    dividends_df: pd.DataFrame | None,
) -> dict:
    """Wrapper guidato da TaxConfig. Non solleva mai: al peggio ritorna lordo + tax_error."""
    gross = prices
    out = {"prices": gross, "cum_tax": None, "tx": tx_df, "summary": {"tax_enabled": False}}
    try:
        if not getattr(tax_cfg, "enabled", False):
            return out
        rates = getattr(tax_cfg, "ticker_rates", {}) or {}
        if not float(getattr(tax_cfg, "default_gain_rate", 0) or 0) and not float(
            getattr(tax_cfg, "default_div_rate", 0) or 0
        ) and not rates:
            return out
        realized = fifo_realized_trades(tx_df)
        raw = _norm_trades(tx_df)
        gain_of = {str(k).upper(): float(v.gain_rate) for k, v in rates.items()}
        div_of = {str(k).upper(): float(v.div_rate) for k, v in rates.items()}
        res = apply_tax(
            prices, realized, raw, coupons_df, dividends_df, gain_of, div_of,
            float(tax_cfg.default_gain_rate), float(tax_cfg.default_div_rate),
            bool(tax_cfg.use_loss_carry), int(tax_cfg.carry_expiry_years),
        )
        try:
            enriched = _enrich_transactions(tx_df, res["trade_detail"])
        except Exception:
            enriched = tx_df
        summary = dict(res["summary"])
        try:
            first = float(pd.to_numeric(gross, errors="coerce").iloc[0])  # type: ignore[union-attr]
            last = float(pd.to_numeric(gross, errors="coerce").iloc[-1])  # type: ignore[union-attr]
            summary["gross_total_return"] = round(last / first - 1, 6) if first else 0.0
        except Exception:
            pass
        out = {"prices": res["equity_net"], "cum_tax": res["cum_tax"], "tx": enriched, "summary": summary}
    except Exception as e:
        out["summary"] = {"tax_enabled": False, "tax_error": str(e)[:300]}
    return out
