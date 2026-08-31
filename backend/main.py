from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.requests import Request
from fastapi.responses import JSONResponse

from backend.api.routes import router as bt_router
from backend.database import init_db
from backend.middleware import _get_api_key

app = FastAPI(title="bt-gui", version="0.1.0")


@app.on_event("startup")
def _init_db():
    init_db()


app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://localhost:3001", "http://localhost:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


_SKIP_PATHS = frozenset({"/", "/docs", "/openapi.json", "/redoc"})


@app.middleware("http")
async def api_key_auth(request: Request, call_next):
    key = _get_api_key()
    if key is None:
        return await call_next(request)
    if request.url.path in _SKIP_PATHS:
        return await call_next(request)
    header = request.headers.get("X-API-Key") or request.headers.get("authorization", "").removeprefix("Bearer ")
    if header == key:
        return await call_next(request)
    return JSONResponse(status_code=401, content={"detail": "unauthorized"})


app.include_router(bt_router)


@app.get("/")
def root():
    return {"name": "bt-gui", "docs": "/docs"}
