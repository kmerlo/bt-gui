from fastapi import APIRouter

router = APIRouter(prefix="/api/bt", tags=["bt-gui"])


@router.get("/health")
def health():
    return {"status": "ok"}


@router.get("/algos")
def list_algos():
    # stub — plan 003 popola con discover_algos()
    return []


@router.get("/algos/{name}/schema")
def algo_schema(name: str):
    return {"class_name": name, "params": {}}
