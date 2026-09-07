import pytest
from backend.services.commission_parser import parse_commission_fn, validate_commission_src


def test_valid_lambda():
    fn = parse_commission_fn("lambda q,p: q*p*0.001")
    assert fn(100, 50) == pytest.approx(5.0)


def test_valid_expression_variants():
    fn = parse_commission_fn("lambda quantity, price: quantity*price*0.002 + 1")
    assert fn(100, 50) == pytest.approx(11.0)


def test_rejects_builtin_access():
    with pytest.raises(ValueError):
        validate_commission_src("lambda q,p: __import__('os').system('x')")


def test_rejects_attribute():
    with pytest.raises(ValueError):
        validate_commission_src("lambda q,p: q.__class__")


def test_rejects_wrong_arity():
    with pytest.raises(ValueError):
        validate_commission_src("lambda q: q")


def test_rejects_call():
    with pytest.raises(ValueError):
        validate_commission_src("lambda q,p: sum([q,p])")


def test_clamped_formula_runs():
    # formula generata dalla modalità parametrica FE: max(MIN, min(MAX, p*abs(q)*perc))
    fn = parse_commission_fn("lambda q,p: max(1, min(100, p*abs(q)*0.001))")
    assert fn(1000, 100) == pytest.approx(100.0)  # cap
    assert fn(10, 1) == pytest.approx(1.0)  # floor
    assert fn(100, 50) == pytest.approx(5.0)  # raw


def test_floor_only_and_cap_only_run():
    assert parse_commission_fn("lambda q,p: max(5, p*abs(q)*0.002)")(10, 10) == pytest.approx(5.0)
    assert parse_commission_fn("lambda q,p: min(50, p*abs(q)*0.0005)")(1000, 100) == pytest.approx(50.0)
