from __future__ import annotations

import inspect
import re
from typing import Any

import bt.algos as algos_mod
from bt.core import Algo

# Map prefix to category label (same 7 buckets as SPEC)
_PREFIX_CATEGORY = [
    ("Run", "Scheduling"),
    ("Select", "Selection"),
    ("Weigh", "Weighting"),
    ("Limit", "Risk"),
    ("Target", "Risk"),
    ("PTE", "Risk"),
    ("Rebalance", "Execution"),
    ("Capital", "Flows"),
    ("Corporate", "Flows"),
    ("Hedge", "Flows"),
    ("Update", "Flows"),
    ("Set", "Flows"),
    ("Replay", "Simulation"),
    ("Simulate", "Simulation"),
    ("Print", "Debug"),
    ("Debug", "Debug"),
]

# Whitelist of (algo_name, param_name) pairs that accept a DataFrame.
# bt.algos has no type annotations for these, so we maintain the list explicitly.
DATAFRAME_PARAM_ALGOS: set[tuple[str, str]] = {
    ("SelectWhere", "signal"),
    ("WeighTarget", "weights"),
}


def _categorise(name: str) -> str:
    for prefix, label in _PREFIX_CATEGORY:
        if name.startswith(prefix):
            return label
    return "Other"


def _parse_requires_sets(doc: str) -> tuple[str | None, str | None]:
    requires = None
    sets = None
    if doc:
        m = re.search(r"Requires:\s*(.+)", doc)
        if m:
            requires = m.group(1).strip()
        m = re.search(r"Sets:\s*(.+)", doc)
        if m:
            sets = m.group(1).strip()
    return requires, sets


def _parse_args_doc(doc: str) -> dict[str, str]:
    params: dict[str, str] = {}
    m = re.search(r"Args:\s*\n((?:[^\n]*\n)*?)(?:\n\s*\n|\n\s*[A-Z][a-z]+:|\Z)", doc)
    if not m:
        return params
    current_param: str | None = None
    current_desc: list[str] = []
    for line in m.group(1).split("\n"):
        pm = re.match(r"\s*\*\s*(\w+)\s*\([^)]*\):\s*(.*)", line)
        if pm:
            if current_param:
                params[current_param] = " ".join(current_desc).strip()
            current_param = pm.group(1)
            current_desc = [pm.group(2).strip()]
        else:
            stripped = line.strip()
            if stripped and current_param:
                current_desc.append(stripped)
    if current_param:
        params[current_param] = " ".join(current_desc).strip()
    return params


def _is_dataframe_param(algo_name: str, param_name: str) -> bool:
    return (algo_name, param_name) in DATAFRAME_PARAM_ALGOS


def discover_algos() -> dict[str, dict]:
    out: dict[str, dict] = {}
    for name in dir(algos_mod):
        obj = getattr(algos_mod, name)
        if not inspect.isclass(obj):
            continue
        if not issubclass(obj, Algo) or obj is Algo:
            continue
        cat = _categorise(name)
        sig = inspect.signature(obj.__init__)
        params: dict[str, dict] = {}
        for k, v in sig.parameters.items():
            if k == "self":
                continue
            params[k] = {
                "annotation": str(v.annotation) if v.annotation is not inspect._empty else "Any",
                "default": v.default if v.default is not inspect._empty else None,
                "required": v.default is inspect._empty,
            }
        doc = (obj.__doc__ or "").strip()
        requires, sets = _parse_requires_sets(doc)
        param_docs = _parse_args_doc(doc)
        out[name] = {
            "category": cat,
            "params": params,
            "doc": doc[:800],
            "requires": requires,
            "sets": sets,
            "param_docs": param_docs,
        }
    return out


REGISTRY: dict[str, dict] = discover_algos()


def build_algo(class_name: str, params: dict | None) -> Any:
    cls = getattr(algos_mod, class_name, None)
    if cls is None:
        raise ValueError(f"Unknown algo {class_name}")
    return cls(**(params or {}))


def algo_json_schema(class_name: str) -> dict:
    info = REGISTRY.get(class_name)
    if not info:
        raise KeyError(class_name)
    props: dict[str, dict] = {}
    req: list[str] = []
    for k, v in info["params"].items():
        prop: dict[str, Any] = {"type": "string", "default": v["default"]}
        if _is_dataframe_param(class_name, k):
            prop["kind"] = "indicator"
            prop["type"] = "string"
        props[k] = prop
        if v["required"]:
            req.append(k)
    return {"title": class_name, "type": "object", "properties": props, "required": req}
