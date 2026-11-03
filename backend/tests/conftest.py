import os
import tempfile

# Use an isolated database and upload folder for the whole test session.
_tmp = tempfile.mkdtemp(prefix="lms-test-")
os.environ["LMS_DATABASE_URL"] = f"sqlite:///{_tmp}/test.db"
os.environ["LMS_UPLOAD_DIR"] = f"{_tmp}/uploads"
os.environ["LMS_AUTO_SEED"] = "0"
os.environ["LMS_SECRET_KEY"] = "test-secret-key-" + "x" * 40

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from app.database import SessionLocal  # noqa: E402
from app.main import app  # noqa: E402
from app.models import User  # noqa: E402
from app.security import hash_password  # noqa: E402


@pytest.fixture(scope="session")
def client():
    with TestClient(app) as c:
        with SessionLocal() as db:
            db.add(
                User(
                    name="Test Admin",
                    email="admin@test.dev",
                    password_hash=hash_password("adminpass"),
                    role="admin",
                )
            )
            db.commit()
        yield c


def login(client, email, password):
    r = client.post("/api/v1/auth/login", json={"email": email, "password": password})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


@pytest.fixture(scope="session")
def admin_h(client):
    return login(client, "admin@test.dev", "adminpass")
