from __future__ import annotations

import ast
from typing import Callable

# ponytail: whitelist AST, expand if bounded use-case needs it (add Call allowlist for max/min/abs)


_ALLOWED_BINOPS = (ast.Add, ast.Sub, ast.Mult, ast.Div, ast.Pow, ast.Mod)
_ALLOWED_UNARYOPS = (ast.UAdd, ast.USub)
_ALLOWED_CALLS = {"max", "min", "abs", "round"}


def _validate_body(node: ast.AST, allowed_names: set[str]) -> None:
    if isinstance(node, ast.BinOp):
        if not isinstance(node.op, _ALLOWED_BINOPS):
            raise ValueError(f"commission: disallowed operator {type(node.op).__name__}")
        _validate_body(node.left, allowed_names)
        _validate_body(node.right, allowed_names)
    elif isinstance(node, ast.UnaryOp):
        if not isinstance(node.op, _ALLOWED_UNARYOPS):
            raise ValueError(f"commission: disallowed unary {type(node.op).__name__}")
        _validate_body(node.operand, allowed_names)
    elif isinstance(node, ast.Constant):
        if not isinstance(node.value, (int, float)):
            raise ValueError("commission: only numeric constants allowed")
    elif isinstance(node, ast.Num):  # py<3.8 compat
        pass
    elif isinstance(node, ast.Name):
        if node.id not in allowed_names:
            raise ValueError(f"commission: name '{node.id}' not allowed")
        if not isinstance(node.ctx, ast.Load):
            raise ValueError("commission: only load allowed")
    elif isinstance(node, ast.IfExp):
        _validate_body(node.test, allowed_names)
        _validate_body(node.body, allowed_names)
        _validate_body(node.orelse, allowed_names)
        # test may be Compare
        if isinstance(node.test, ast.Compare):
            _validate_body(node.test, allowed_names)
        elif not isinstance(node.test, (ast.Name, ast.Constant, ast.BinOp, ast.UnaryOp, ast.Num)):
            # allow compare as test, else fallback to generic check
            pass
    elif isinstance(node, ast.Compare):
        # allow e.g. q > 0 ? used in IfExp test
        if len(node.ops) != 1 or len(node.comparators) != 1:
            raise ValueError("commission: only single compare allowed")
        if not all(isinstance(op, (ast.Gt, ast.Lt, ast.GtE, ast.LtE, ast.Eq, ast.NotEq)) for op in node.ops):
            raise ValueError("commission: disallowed compare operator")
        _validate_body(node.left, allowed_names)
        for c in node.comparators:
            _validate_body(c, allowed_names)
    elif isinstance(node, ast.Call):
        if not isinstance(node.func, ast.Name) or node.func.id not in _ALLOWED_CALLS:
            raise ValueError(f"commission: disallowed call {getattr(node.func, 'id', type(node.func).__name__)}")
        if node.keywords:
            raise ValueError("commission: keyword args not allowed")
        for arg in node.args:
            _validate_body(arg, allowed_names)
    elif isinstance(node, ast.Expression):
        _validate_body(node.body, allowed_names)
    else:
        raise ValueError(f"commission: disallowed syntax {type(node).__name__}")


def validate_commission_src(src: str) -> str:
    try:
        tree = ast.parse(src, mode="eval")
    except SyntaxError as e:
        raise ValueError(f"commission: syntax error {e}") from e
    if not isinstance(tree, ast.Expression) or not isinstance(tree.body, ast.Lambda):
        raise ValueError("commission: must be lambda")
    lam = tree.body
    if len(lam.args.args) != 2:
        raise ValueError("commission: lambda must have exactly 2 args (q,p)")
    if lam.args.vararg or lam.args.kwarg or lam.args.kwonlyargs or lam.args.defaults or lam.args.kw_defaults:
        raise ValueError("commission: lambda must have plain 2 args")
    allowed = {a.arg for a in lam.args.args}
    _validate_body(lam.body, allowed)
    return src


def parse_commission_fn(src: str) -> Callable[[float, float], float]:
    validate_commission_src(src)
    code = compile(ast.parse(src, mode="eval"), "<commission>", "eval")
    fn = eval(code, {"__builtins__": {}})  # noqa: S307
    if not callable(fn):
        raise ValueError("commission: not callable")
    return fn  # type: ignore[return-value]
