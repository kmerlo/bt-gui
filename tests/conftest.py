import pytest
from backend.database import get_active_db, set_active_db, init_db

@pytest.fixture(scope="session", autouse=True)
def use_test_db():
    # Switch to test DB for entire pytest session, restore after
    prev = get_active_db()
    # ensure test DB exists
    init_db()
    set_active_db("test")
    yield
    # restore previous selection (usually "main")
    try:
        set_active_db(prev)
    except Exception:
        pass
