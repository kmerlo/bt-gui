import pytest
import pandas as pd

from backend.services.signal_engine import evaluate_expression


@pytest.fixture
def sample_indicators():
    return {
        "1": pd.DataFrame({"A": [1.0, 2.0, 3.0, 4.0, 5.0]}),
        "2": pd.DataFrame({"A": [5.0, 4.0, 3.0, 2.0, 1.0]}),
    }


@pytest.fixture
def sample_price():
    return pd.DataFrame({"A": [2.0, 1.5, 3.5, 4.5, 4.0]})


class TestGtLtGteLte:
    def test_gt(self, sample_indicators):
        result = evaluate_expression(
            {"op": "gt", "left": {"type": "indicator", "id": "1"}, "right": {"type": "value", "v": 1.5}},
            sample_indicators,
            sample_price,
        )
        assert result.to_dict() == {"A": {0: False, 1: True, 2: True, 3: True, 4: True}}

    def test_lt(self, sample_indicators):
        result = evaluate_expression(
            {"op": "lt", "left": {"type": "indicator", "id": "1"}, "right": {"type": "value", "v": 3.0}},
            sample_indicators,
            sample_price,
        )
        assert result.to_dict() == {"A": {0: True, 1: True, 2: False, 3: False, 4: False}}

    def test_gte(self, sample_indicators):
        result = evaluate_expression(
            {"op": "gte", "left": {"type": "indicator", "id": "1"}, "right": {"type": "value", "v": 3.0}},
            sample_indicators,
            sample_price,
        )
        assert result.to_dict() == {"A": {0: False, 1: False, 2: True, 3: True, 4: True}}

    def test_lte(self, sample_indicators):
        result = evaluate_expression(
            {"op": "lte", "left": {"type": "indicator", "id": "1"}, "right": {"type": "value", "v": 3.0}},
            sample_indicators,
            sample_price,
        )
        assert result.to_dict() == {"A": {0: True, 1: True, 2: True, 3: False, 4: False}}

    def test_eq(self, sample_indicators):
        result = evaluate_expression(
            {"op": "eq", "left": {"type": "indicator", "id": "1"}, "right": {"type": "value", "v": 3.0}},
            sample_indicators,
            sample_price,
        )
        assert result.to_dict() == {"A": {0: False, 1: False, 2: True, 3: False, 4: False}}

    def test_neq(self, sample_indicators):
        result = evaluate_expression(
            {"op": "neq", "left": {"type": "indicator", "id": "1"}, "right": {"type": "value", "v": 3.0}},
            sample_indicators,
            sample_price,
        )
        assert result.to_dict() == {"A": {0: True, 1: True, 2: False, 3: True, 4: True}}


class TestAboveBelow:
    def test_above(self, sample_indicators, sample_price):
        result = evaluate_expression(
            {"op": "above", "left": {"type": "indicator", "id": "1"}},
            sample_indicators,
            sample_price,
        )
        # price > indicator: [2>1, 1.5>2, 3.5>3, 4.5>4, 4>5]
        assert result.to_dict() == {"A": {0: True, 1: False, 2: True, 3: True, 4: False}}

    def test_below(self, sample_indicators, sample_price):
        result = evaluate_expression(
            {"op": "below", "left": {"type": "indicator", "id": "1"}},
            sample_indicators,
            sample_price,
        )
        # price < indicator: [2<1, 1.5<2, 3.5<3, 4.5<4, 4<5]
        assert result.to_dict() == {"A": {0: False, 1: True, 2: False, 3: False, 4: True}}


class TestCrossOverCrossDown:
    def test_cross_over(self, sample_indicators):
        # indicator > shift(1): [NaN, 2>1, 3>2, 4>3, 5>4]
        result = evaluate_expression(
            {"op": "cross_over", "left": {"type": "indicator", "id": "1"}},
            sample_indicators,
            sample_price,
        )
        assert result.to_dict() == {"A": {0: False, 1: True, 2: True, 3: True, 4: True}}

    def test_cross_down(self, sample_indicators):
        # indicator < shift(1): [NaN, 2<1, 3<2, 4<3, 5<4]
        result = evaluate_expression(
            {"op": "cross_down", "left": {"type": "indicator", "id": "2"}},
            sample_indicators,
            sample_price,
        )
        assert result.to_dict() == {"A": {0: False, 1: True, 2: True, 3: True, 4: True}}


class TestTwoOperandCross:
    def test_cross_over_two_operand(self):
        indicators = {
            "fast": pd.DataFrame({"A": [1.0, 2.0, 4.0, 5.0, 6.0]}),
            "slow": pd.DataFrame({"A": [3.0, 3.0, 3.0, 3.0, 3.0]}),
        }
        price = pd.DataFrame({"A": [1.0, 1.0, 1.0, 1.0, 1.0]})
        result = evaluate_expression(
            {"op": "cross_over", "left": {"type": "indicator", "id": "fast"}, "right": {"type": "indicator", "id": "slow"}},
            indicators,
            price,
        )
        # True exactly on the crossing bar (idx 2: 4>3 and 2<=3)
        assert result.to_dict() == {"A": {0: False, 1: False, 2: True, 3: False, 4: False}}

    def test_cross_down_two_operand(self):
        indicators = {
            "fast": pd.DataFrame({"A": [5.0, 4.0, 2.0, 1.0, 0.0]}),
            "slow": pd.DataFrame({"A": [3.0, 3.0, 3.0, 3.0, 3.0]}),
        }
        price = pd.DataFrame({"A": [1.0, 1.0, 1.0, 1.0, 1.0]})
        result = evaluate_expression(
            {"op": "cross_down", "left": {"type": "indicator", "id": "fast"}, "right": {"type": "indicator", "id": "slow"}},
            indicators,
            price,
        )
        # True exactly on the crossing bar (idx 2: 2<3 and 4>=3)
        assert result.to_dict() == {"A": {0: False, 1: False, 2: True, 3: False, 4: False}}

    def test_cross_over_misaligned_columns_and_index(self):
        price = pd.DataFrame({"A": [1.0] * 5, "B": [1.0] * 5})
        indicators = {
            # reversed columns + shuffled index (values keyed by label) — must align, not crash
            "fast": pd.DataFrame({"B": [2.0, 3.0, 4.0, 5.0, 6.0], "A": [6.0, 5.0, 4.0, 2.0, 1.0]}, index=[4, 3, 2, 1, 0]),
            "slow": pd.DataFrame({"A": [3.0] * 5, "B": [3.0] * 5}),
        }
        result = evaluate_expression(
            {"op": "cross_over", "left": {"type": "indicator", "id": "fast"}, "right": {"type": "indicator", "id": "slow"}},
            indicators,
            price,
        )
        assert result.to_dict() == {
            "A": {0: False, 1: False, 2: True, 3: False, 4: False},
            "B": {0: False, 1: False, 2: False, 3: False, 4: False},
        }

    def test_cross_over_scalar_threshold(self):
        indicators = {"fast": pd.DataFrame({"A": [1.0, 2.0, 4.0, 5.0, 6.0]})}
        price = pd.DataFrame({"A": [1.0, 1.0, 1.0, 1.0, 1.0]})
        result = evaluate_expression(
            {"op": "cross_over", "left": {"type": "indicator", "id": "fast"}, "right": {"type": "value", "v": 3.0}},
            indicators,
            price,
        )
        assert result.to_dict() == {"A": {0: False, 1: False, 2: True, 3: False, 4: False}}

    def test_cross_single_operand_legacy_preserved(self, sample_indicators, sample_price):
        # no `right` key (FE SignalPanel shape) → legacy rising/falling momentum form
        result = evaluate_expression(
            {"op": "cross_over", "left": {"type": "indicator", "id": "1"}},
            sample_indicators,
            sample_price,
        )
        assert result.to_dict() == {"A": {0: False, 1: True, 2: True, 3: True, 4: True}}


class TestBoolFastPath:
    def test_bool_frame_bypasses_condition(self):
        from backend.models.strategy_tree import AlgoConfig
        from backend.services.tree_serializer import _resolve_indicator_params

        price = pd.DataFrame({"A": [1.0, 2.0, 3.0]})
        bool_df = pd.DataFrame({"A": [True, False, True]})
        # condition None would apply .notna() → all True if NOT bypassed
        cfg = AlgoConfig(class_name="SelectWhere", params={"signal": "1"}, signal_condition=None)
        out = _resolve_indicator_params(cfg, {"1": bool_df}, price)
        pd.testing.assert_frame_equal(out["signal"], bool_df)

    def test_int_frame_still_thresholded(self):
        from backend.models.strategy_tree import AlgoConfig
        from backend.services.tree_serializer import _resolve_indicator_params

        price = pd.DataFrame({"A": [1.0, 2.0, 3.0]})
        int_df = pd.DataFrame({"A": [1, -2, 3]})
        cfg = AlgoConfig(class_name="SelectWhere", params={"signal": "1"}, signal_condition={"op": "gt", "value": 0})
        out = _resolve_indicator_params(cfg, {"1": int_df}, price)
        assert out["signal"].to_dict() == {"A": {0: True, 1: False, 2: True}}

    def test_gt_threshold_unchanged(self):
        from backend.services.tree_serializer import _apply_signal_condition

        df = pd.DataFrame({"A": [1, -2, 3]})
        price = pd.DataFrame({"A": [1.0, 2.0, 3.0]})
        out = _apply_signal_condition(df, {"op": "gt", "value": 0}, price)
        assert out.to_dict() == {"A": {0: True, 1: False, 2: True}}


class TestAndOrNot:
    def test_and(self, sample_indicators):
        result = evaluate_expression(
            {
                "op": "and",
                "left": {"op": "gt", "left": {"type": "indicator", "id": "1"}, "right": {"type": "value", "v": 1.5}},
                "right": {"op": "lt", "left": {"type": "indicator", "id": "2"}, "right": {"type": "value", "v": 3.0}},
            },
            sample_indicators,
            sample_price,
        )
        # A>1.5 AND B<3: A=[1,2,3,4,5] B=[5,4,3,2,1] → [F&T, T&F, T&F, T&T, T&T] = [F, F, F, T, T]
        assert result.to_dict() == {"A": {0: False, 1: False, 2: False, 3: True, 4: True}}

    def test_or(self, sample_indicators):
        result = evaluate_expression(
            {
                "op": "or",
                "left": {"op": "gt", "left": {"type": "indicator", "id": "1"}, "right": {"type": "value", "v": 4.0}},
                "right": {"op": "lt", "left": {"type": "indicator", "id": "2"}, "right": {"type": "value", "v": 2.0}},
            },
            sample_indicators,
            sample_price,
        )
        # A>4 OR B<2: [F|F, F|F, F|F, F|F, T|T] = [F, F, F, F, T]
        assert result.to_dict() == {"A": {0: False, 1: False, 2: False, 3: False, 4: True}}

    def test_not(self, sample_indicators):
        result = evaluate_expression(
            {
                "op": "not",
                "expr": {"op": "gt", "left": {"type": "indicator", "id": "1"}, "right": {"type": "value", "v": 2.0}},
            },
            sample_indicators,
            sample_price,
        )
        # NOT(A>2): [F, F, T, T, T]
        assert result.to_dict() == {"A": {0: True, 1: True, 2: False, 3: False, 4: False}}

    def test_nested(self, sample_indicators):
        result = evaluate_expression(
            {
                "op": "and",
                "left": {
                    "op": "or",
                    "left": {"op": "gt", "left": {"type": "indicator", "id": "1"}, "right": {"type": "value", "v": 4.0}},
                    "right": {"op": "lt", "left": {"type": "indicator", "id": "2"}, "right": {"type": "value", "v": 2.0}},
                },
                "right": {"op": "gt", "left": {"type": "indicator", "id": "1"}, "right": {"type": "value", "v": 0}},
            },
            sample_indicators,
            sample_price,
        )
        # (A>4 OR B<2) AND A>0: A>4=[F,F,F,F,T] B<2=[F,F,F,F,T] OR=[F,F,F,F,T] AND TTTT=[F,F,F,F,T]
        assert result.to_dict() == {"A": {0: False, 1: False, 2: False, 3: False, 4: True}}


class TestErrors:
    def test_unknown_op(self, sample_indicators):
        with pytest.raises(ValueError, match="Unsupported op"):
            evaluate_expression({"op": "foo", "left": {"type": "indicator", "id": "1"}}, sample_indicators, sample_price)

    def test_unknown_type(self, sample_indicators):
        with pytest.raises(ValueError, match="Unknown expression type"):
            evaluate_expression({"op": "gt", "left": {"type": "unknown", "id": "1"}}, sample_indicators, sample_price)

    def test_missing_indicator(self, sample_indicators):
        with pytest.raises(KeyError):
            evaluate_expression({"op": "gt", "left": {"type": "indicator", "id": "99"}}, sample_indicators, sample_price)
