"""Test that tree_serializer resolves indicator refs in algo params."""

import pandas as pd

from backend.models.strategy_tree import AlgoConfig, NodeConfig, StrategyTree
from backend.services.indicator_calculator import compute_sma
from backend.services.tree_serializer import to_bt_strategy


def _make_price_df(days: int = 30) -> pd.DataFrame:
    idx = pd.date_range("2020-01-02", periods=days, freq="B")
    return pd.DataFrame({"close": [100.0 + i for i in range(days)]}, index=idx)


def _make_indicator_df() -> pd.DataFrame:
    df = _make_price_df()
    return compute_sma(df, period=5)


def test_to_bt_strategy_without_indicators_still_works():
    """Regression: existing strategies without indicator refs must still work."""
    tree = StrategyTree(
        name="test_no_ind",
        root=NodeConfig(
            name="root",
            type="Strategy",
            algos=[
                AlgoConfig(class_name="RunMonthly"),
                AlgoConfig(class_name="SelectAll"),
                AlgoConfig(class_name="WeighEqually"),
                AlgoConfig(class_name="Rebalance"),
            ],
            children=[
                NodeConfig(name="AAPL", type="Security"),
                NodeConfig(name="MSFT", type="Security"),
            ],
        ),
    )
    strategy = to_bt_strategy(tree)
    assert strategy is not None
    # Strategy name comes from root node name, not tree.name
    assert strategy.name == "root"


def test_to_bt_strategy_with_indicator_ref_resolved():
    """When an algo param is an integer-looking string, resolve to DataFrame."""
    ind_df = _make_indicator_df()
    tree = StrategyTree(
        name="test_with_ind",
        root=NodeConfig(
            name="root",
            type="Strategy",
            algos=[
                AlgoConfig(class_name="RunMonthly"),
                AlgoConfig(class_name="SelectWhere", params={"signal": "1"}),
                AlgoConfig(class_name="WeighEqually"),
                AlgoConfig(class_name="Rebalance"),
            ],
            children=[
                NodeConfig(name="AAPL", type="Security"),
                NodeConfig(name="MSFT", type="Security"),
            ],
        ),
    )
    indicators = {"1": ind_df}
    strategy = to_bt_strategy(tree, indicators=indicators)
    assert strategy is not None

    algo_stack = strategy.stack
    select_where = next((a for a in algo_stack.algos if a.__class__.__name__ == "SelectWhere"), None)
    assert select_where is not None
    assert isinstance(select_where.signal, pd.DataFrame), f"Expected DataFrame, got {type(select_where.signal)}"
    assert "sma_5" in select_where.signal.columns


def test_to_bt_strategy_with_unresolved_string_leaves_name():
    """If the indicator ref is a non-numeric string, leave it as signal_name."""
    tree = StrategyTree(
        name="test_unresolved",
        root=NodeConfig(
            name="root",
            type="Strategy",
            algos=[
                AlgoConfig(class_name="RunMonthly"),
                AlgoConfig(class_name="SelectWhere", params={"signal": "my_signal_name"}),
                AlgoConfig(class_name="WeighEqually"),
                AlgoConfig(class_name="Rebalance"),
            ],
            children=[NodeConfig(name="AAPL", type="Security")],
        ),
    )
    indicators: dict[str, pd.DataFrame] = {}
    strategy = to_bt_strategy(tree, indicators=indicators)
    assert strategy is not None

    algo_stack = strategy.stack
    select_where = next((a for a in algo_stack.algos if a.__class__.__name__ == "SelectWhere"), None)
    assert select_where is not None
    # Non-integer string → bt stores it in signal_name, signal stays None
    assert select_where.signal_name == "my_signal_name"
    assert select_where.signal is None


def test_to_bt_strategy_weigh_target_with_indicator():
    """WeighTarget with integer-string indicator ref receives DataFrame."""
    tw_df = _make_price_df()
    tw_df["weight"] = 0.6
    tree = StrategyTree(
        name="test_weight_target",
        root=NodeConfig(
            name="root",
            type="Strategy",
            algos=[
                AlgoConfig(class_name="RunMonthly"),
                AlgoConfig(class_name="WeighTarget", params={"weights": "2"}),
                AlgoConfig(class_name="Rebalance"),
            ],
            children=[
                NodeConfig(name="AAPL", type="Security"),
                NodeConfig(name="MSFT", type="Security"),
            ],
        ),
    )
    indicators = {"2": tw_df}
    strategy = to_bt_strategy(tree, indicators=indicators)
    assert strategy is not None

    algo_stack = strategy.stack
    weigh_target = next((a for a in algo_stack.algos if a.__class__.__name__ == "WeighTarget"), None)
    assert weigh_target is not None
    assert isinstance(weigh_target.weights, pd.DataFrame)
