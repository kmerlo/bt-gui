from __future__ import annotations

import hmac
import os

# ponytail: simple API key auth; upgrade to JWT or mTLS if multi-user access is needed
_SKIP_PATHS = frozenset({"/", "/docs", "/openapi.json", "/redoc"})


def _get_api_key() -> str | None:
    return os.environ.get("BT_API_KEY") or os.environ.get("BT_GUI_API_KEY")


def is_valid_api_key(candidate: str | None) -> bool:
    """True if candidate matches the configured key, or if no key is configured (dev mode stays open)."""
    key = _get_api_key()
    if key is None:
        return True
    if not candidate:
        return False
    return hmac.compare_digest(candidate, key)

