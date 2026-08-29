#!/usr/bin/env bash

cd /home/roberto/Documents/progetti/bt-gui
uv sync                                    # installa dipendenze se necessario
uv run uvicorn backend.main:app --host 127.0.0.1 --port 8001  --reload
