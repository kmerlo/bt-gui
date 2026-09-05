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
    ("EntryGate", "Selection"),
    ("Entry", "Selection"),
    ("StopLoss", "Risk"),
    ("Stop", "Risk"),
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
    ("EntryGateMemory", "cross_signal"),
    ("EntryGateMemory", "filter_signal"),
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
    # ponytail: include both bt.algos and custom_algos (StopLossTakeProfit etc.)
    try:
        import backend.services.custom_algos as custom_mod
    except Exception:
        custom_mod = None  # type: ignore[assignment]
    modules = [algos_mod] + ([custom_mod] if custom_mod is not None else [])
    for mod in modules:
        for name in dir(mod):
            obj = getattr(mod, name)
            if not inspect.isclass(obj):
                continue
            if not issubclass(obj, Algo) or obj is Algo:
                continue
            if name in out:
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


def _coerce_param_value(class_name: str, param_name: str, value: Any) -> Any:
    """Coerce string numeric/bool params stored as strings (e.g. '0.4', 'true') to proper python types.

    Skips DataFrame params (SelectWhere.signal, WeighTarget.weights) which must stay as string IDs.
    """
    if _is_dataframe_param(class_name, param_name):
        return value
    if not isinstance(value, str):
        return value
    s = value.strip()
    if not s:
        return value
    # boolean (bt alogs use bool for RunMonthly etc.)
    low = s.lower()
    if low in ("true", "false"):
        # check default type to confirm bool expected, but also coerce anyway
        info = REGISTRY.get(class_name, {}).get("params", {}).get(param_name)
        if info and isinstance(info.get("default"), bool):
            return low == "true"
        # fallback: treat as bool for known boolean param names
        if param_name.startswith("run_on_") or param_name in ("is_price", "is_cash"):
            return low == "true"
        return low == "true"
    # numeric: try int/float
    # ponytail: handle both int and float strings; default type guides choice
    info = REGISTRY.get(class_name, {}).get("params", {}).get(param_name)
    default = info.get("default") if info else None
    # try to parse as float first if contains '.' or default is float
    try:
        if isinstance(default, float):
            return float(s)
        if isinstance(default, int) and not isinstance(default, bool):
            # int param but may be passed as '0.4' -> float then int
            if "." in s or "e" in s.lower():
                return float(s)
            return int(float(s)) if "." in s else int(s)
        # unknown default: try int then float
        if "." in s or "e" in s.lower():
            return float(s)
        return int(s)
    except Exception:
        try:
            return float(s)
        except Exception:
            return value


def build_algo(class_name: str, params: dict | None) -> Any:
    cls = getattr(algos_mod, class_name, None)
    if cls is None:
        try:
            import backend.services.custom_algos as custom_mod

            cls = getattr(custom_mod, class_name, None)
        except Exception:
            cls = None
    if cls is None:
        raise ValueError(f"Unknown algo {class_name}")
    p = dict(params or {})
    # ponytail: coerce stale string params (e.g. LimitWeights limit '0.4' -> 0.4) before instantiation
    for kk, vv in list(p.items()):
        p[kk] = _coerce_param_value(class_name, kk, vv)
    # ponytail: WeighSpecified is **weights — GUI passes single "weights" field as JSON/dict, unpack it
    if class_name == "WeighSpecified" and "weights" in p:
        w = p.pop("weights")
        if isinstance(w, str):
            # ponytail: normalise typographic quotes that users paste from docs/chat
            w = w.strip().replace('“', '"').replace('”', '"').replace('‘', "'").replace('’', "'")
            if w:
                import json

                try:
                    w = json.loads(w)
                except Exception:
                    # fallback: "SPY:0.6,AGG:0.4" or "SPY=0.6, AGG=0.4"
                    try:
                        # strip outer braces for fallback single-quote JSON
                        w_clean = w.strip()
                        if w_clean.startswith("{") and w_clean.endswith("}"):
                            w_clean = w_clean[1:-1]
                        d: dict[str, float] = {}
                        for part in w_clean.split(","):
                            part = part.strip()
                            if not part:
                                continue
                            sep = ":" if ":" in part else "=" if "=" in part else None
                            if sep:
                                k, v = part.split(sep, 1)
                                k = k.strip().strip('"\'').strip().lstrip("{[").rstrip("]}").strip().upper()
                                v = v.strip().strip('"\'').strip().lstrip("{[").rstrip("]}").strip()
                                if not k:
                                    continue
                                d[k] = float(v)
                            else:
                                k = part.strip().strip('"\'').strip().lstrip("{[").rstrip("]}").strip().upper()
                                if k:
                                    d[k] = 1.0
                        w = d
                    except Exception:
                        w = {}
            else:
                w = {}
        if isinstance(w, dict):
            for k, v in w.items():
                # ponytail: normalize ticker keys — strip quotes/spaces and upper-case to match Security names & price columns
                ck = str(k).strip().strip('"\'').strip().upper()
                if not ck:
                    continue
                if isinstance(v, str):
                    v = v.strip().strip('"\'').strip()
                try:
                    fv = float(v)  # type: ignore[arg-type]
                except Exception:
                    fv = v  # let bt raise if truly invalid
                p[ck] = fv
        elif w is not None:
            p["weights"] = w
    # also normalize direct ticker keys (e.g. {"spy":0.6}) to upper
    if class_name == "WeighSpecified":
        p = {str(k).strip().strip('"\'').strip().upper(): v for k, v in p.items()}
    return cls(**p)


def _serialize_default(v: Any) -> Any:
    if v is None or v is inspect._empty:
        return None
    if isinstance(v, bool):
        return v
    if isinstance(v, (int, float, str)):
        return v
    # pandas DateOffset and similar -> "<DateOffset: months=3>"
    try:
        s = str(v)
        if s.startswith("<DateOffset"):
            return s
    except Exception:
        pass
    if isinstance(v, (tuple, list)):
        return str(v)
    # fallback: DateOffset, classes, etc.
    try:
        return str(v)
    except Exception:
        return None


def algo_json_schema(class_name: str) -> dict:
    info = REGISTRY.get(class_name)
    if not info:
        raise KeyError(class_name)
    props: dict[str, dict] = {}
    req: list[str] = []
    for k, v in info["params"].items():
        prop: dict[str, Any] = {"type": "string", "default": _serialize_default(v["default"])}
        if _is_dataframe_param(class_name, k):
            prop["kind"] = "indicator"
            prop["type"] = "string"
        props[k] = prop
        if v["required"]:
            req.append(k)
    return {"title": class_name, "type": "object", "properties": props, "required": req}
