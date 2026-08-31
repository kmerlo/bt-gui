from __future__ import annotations

import os

# ponytail: simple API key auth; upgrade to JWT or mTLS if multi-user access is needed
_SKIP_PATHS = frozenset({"/", "/docs", "/openapi.json", "/redoc"})


def _get_api_key() -> str | None:
    return os.environ.get("BT_API_KEY") or os.environ.get("BT_GUI_API_KEY")

