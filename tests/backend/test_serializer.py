import bt
import numpy as np
import pandas as pd

from backend.models.strategy_tree import StrategyTree
from backend.services.tree_serializer import to_bt_strategy


def test_simple_tree():
    t = StrategyTree(
        name="test",
        root={
            "name": "root",
            "type": "Strategy",
            "algos": [
                {"class_name": "RunMonthly"},
                {"class_name": "SelectAll"},
                {"class_name": "WeighEqually"},
                {"class_name": "Rebalance"},
            ],
            "children": [
                {"name": "AAPL", "type": "Security"},
                {"name": "MSFT", "type": "Security"},
            ],
        },
    )
    s = to_bt_strategy(t)
    assert s.name == "root"
    assert len(s.members) == 3
    assert s["AAPL"].name == "AAPL"


def test_nested_strategy():
    t = StrategyTree(
        name="nested",
        root={
            "name": "root",
            "type": "Strategy",
            "algos": [
                {"class_name": "RunMonthly"},
                {"class_name": "SelectAll"},
                {"class_name": "WeighEqually"},
                {"class_name": "Rebalance"},
            ],
            "children": [
                {"name": "AAPL", "type": "Security"},
                {
                    "name": "sub",
                    "type": "Strategy",
                    "algos": [
                        {"class_name": "RunMonthly"},
                        {"class_name": "SelectAll"},
                        {"class_name": "WeighEqually"},
                        {"class_name": "Rebalance"},
                    ],
                    "children": [{"name": "GOOG", "type": "Security"}],
                },
            ],
        },
    )
    s = to_bt_strategy(t)
    assert len(s.members) == 4
    assert s["sub"].name == "sub"


def test_five_node_types():
    for ntype in ["Security", "HedgeSecurity", "CouponPayingSecurity"]:
        t = StrategyTree(
            name=f"test-{ntype}",
            root={
                "name": "root",
                "type": "Strategy",
                "algos": [
                    {"class_name": "RunMonthly"},
                    {"class_name": "SelectAll"},
                    {"class_name": "WeighEqually"},
                    {"class_name": "Rebalance"},
                ],
                "children": [{"name": "TICK", "type": ntype}],
            },
        )
        s = to_bt_strategy(t)
        assert s["TICK"].name == "TICK"


def test_fixed_income_strategy():
    t = StrategyTree(
        name="fi",
        root={
            "name": "root",
            "type": "FixedIncomeStrategy",
            "children": [{"name": "BOND", "type": "Security"}],
        },
    )
    s = to_bt_strategy(t)
    assert s.fixed_income is True


def test_security_params_multiplier():
    t = StrategyTree(
        name="mult",
        root={
            "name": "root",
            "type": "Strategy",
            "children": [{"name": "AAPL", "type": "Security", "params": {"multiplier": 2}}],
        },
    )
    s = to_bt_strategy(t)
    assert s["AAPL"].multiplier == 2


def test_backtest_integration():
    t = StrategyTree(
        name="bt-test",
        root={
            "name": "root",
            "type": "Strategy",
            "algos": [
                {"class_name": "RunMonthly"},
                {"class_name": "SelectAll"},
                {"class_name": "WeighEqually"},
                {"class_name": "Rebalance"},
            ],
            "children": [
                {"name": "AAPL", "type": "Security"},
                {"name": "MSFT", "type": "Security"},
            ],
        },
    )
    s = to_bt_strategy(t)
    dates = pd.date_range("2020-01-01", periods=30, freq="B")
    df = pd.DataFrame(np.random.randn(30, 2) + 100, index=dates, columns=["AAPL", "MSFT"])
    bkt = bt.Backtest(s, df)
    bkt.run()
    assert len(bkt.strategy.prices) == 31  # includes t0-1 dummy row


def test_invalid_type():

    t = StrategyTree(
        name="bad",
        root={"name": "root", "type": "Strategy", "children": [{"name": "X", "type": "Security", "children": [{"name": "Y", "type": "Security"}]}]},  # type: ignore
    )
    try:
        to_bt_strategy(t)
        assert False, "should raise"
    except ValueError as e:
        assert "cannot have children" in str(e).lower()


def test_invalid_algo():

    t = StrategyTree(
        name="bad-algo",
        root={"name": "root", "type": "Strategy", "algos": [{"class_name": "NoSuchAlgo"}], "children": [{"name": "AAPL", "type": "Security"}]},
    )
    try:
        to_bt_strategy(t)
        assert False
    except ValueError as e:
        assert "Unknown algo" in str(e)
