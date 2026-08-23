from backend.services.algo_registry import REGISTRY, algo_json_schema, build_algo


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
