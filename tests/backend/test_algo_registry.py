from backend.services.algo_registry import REGISTRY, algo_json_schema, build_algo

import pandas as pd
import pytest


def test_registry_contains_key_algos():
    for name in ["RunMonthly", "WeighEqually", "Rebalance", "SelectAll"]:
        assert name in REGISTRY, f"{name} missing"
    assert len(REGISTRY) >= 30


def test_categories_non_empty():
    cats = {info["category"] for info in REGISTRY.values()}
    assert "Scheduling" in cats
    assert "Selection" in cats
    assert "Weighting" in cats
    assert "Execution" in cats


def test_build_algo():
    algo = build_algo("WeighEqually", {})
    assert algo is not None
    assert algo.name == "WeighEqually"


def test_build_unknown_raises():
    import pytest

    with pytest.raises(ValueError, match="Unknown algo"):
        build_algo("NoSuchAlgo", {})


def test_schema():
    schema = algo_json_schema("WeighEqually")
    assert schema["title"] == "WeighEqually"
    assert "properties" in schema
    assert "required" in schema


def test_schema_unknown():
    import pytest

    with pytest.raises(KeyError):
        algo_json_schema("NoSuchAlgo")


def test_requires_sets_extracted():
    # Rebalance should have Requires
    info = REGISTRY.get("Rebalance")
    assert info is not None
    # doc may contain Requires/Sets — at least one of them should be parsed for some algo
    has_requires = any(v.get("requires") for v in REGISTRY.values())
    has_sets = any(v.get("sets") for v in REGISTRY.values())
    assert has_requires or has_sets


def test_dateoffset_params_parsed():
    algo = build_algo("SelectMomentum", {"n": "4", "lookback": "months=6"})
    assert algo.algos[0].lookback == pd.DateOffset(months=6)
    algo = build_algo("WeighERC", {"lookback": "years=1, days=0"})
    assert algo.lookback == pd.DateOffset(years=1, days=0)


def test_dateoffset_invalid_raises():
    with pytest.raises(ValueError, match="Invalid DateOffset"):
        build_algo("SelectMomentum", {"n": 4, "lookback": "6"})
    with pytest.raises(ValueError, match="Invalid DateOffset"):
        build_algo("WeighInvVol", {"lookback": "fortnights=2"})


def test_empty_optional_params_dropped_to_default():
    algo = build_algo("SelectMomentum", {"n": 4, "lookback": "", "lag": "  "})
    assert algo.algos[0].lookback == pd.DateOffset(months=3)
    assert build_algo("WeighSpecified", {"weights": ""}).weights == {}


def test_empty_required_param_raises():
    with pytest.raises(ValueError, match="requires param 'date'"):
        build_algo("RunAfterDate", {"date": ""})


def test_var_keyword_not_required():
    assert REGISTRY["WeighSpecified"]["params"]["weights"]["required"] is False


def test_list_param_json_parsed():
    # ponytail: RegimeRotation.sectors is list[str]|None with default None —
    # GUI sends JSON string '["XLY","XLE"]' which must be parsed, not iterated as chars
    import importlib

    import backend.services.algo_registry as m

    importlib.reload(m)
    algo = m.build_algo("RegimeRotation", {"sectors": '["XLY","XLP","XLE"]'})
    assert algo.sectors == ["XLY", "XLP", "XLE"]
    # non-JSON string falls through unchanged → algo constructor iterates chars (legacy behavior)
    algo2 = m.build_algo("RegimeRotation", {"sectors": "not-json"})
    assert algo2.sectors == list("NOT-JSON")
