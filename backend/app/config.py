"""Application settings, read from environment variables with safe dev defaults."""
import os
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent
FRONTEND_DIR = BASE_DIR.parent / "frontend"


def load_env_file(path: Path) -> None:
    """Load KEY=VALUE lines from a .env file. Real environment variables win."""
    try:
        lines = path.read_text(encoding="utf-8-sig").splitlines()
    except OSError:
        return
    for line in lines:
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        key, value = key.strip().removeprefix("export ").strip(), value.strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in "\"'":
            value = value[1:-1]  # quoted value: keep everything inside, including '#'
        elif " #" in value:
            value = value.split(" #", 1)[0].rstrip()  # inline comment
        if key:
            os.environ.setdefault(key, value)


# Looks for a .env in backend/ first, then in the project root.
for _candidate in (BASE_DIR / ".env", BASE_DIR.parent / ".env"):
    load_env_file(_candidate)

# IMPORTANT: set LMS_SECRET_KEY to a long random string in production.
SECRET_KEY = os.getenv(
    "LMS_SECRET_KEY", "dev-secret-change-me-please-use-a-long-random-string"
)
ALGORITHM = "HS256"
TOKEN_MINUTES = int(os.getenv("LMS_TOKEN_MINUTES", "720"))

# ---- Database (PostgreSQL) -----------------------------------------------
# On Render (and Heroku, Railway, ...) a single DATABASE_URL is provided; it is used
# automatically. Otherwise the individual settings below are combined into a URL.
DB_HOST = os.getenv("LMS_DB_HOST", "dpg-dbbfh061egvs73fsa060-a")
DB_PORT = int(os.getenv("LMS_DB_PORT", "5432"))
DB_USER = os.getenv("LMS_DB_USER", "training_8cn2_user")
DB_PASSWORD = os.getenv("LMS_DB_PASSWORD", "D4JUFWusk4GVGqMXLDVMSZWFz2TEFybU")
DB_NAME = os.getenv("LMS_DB_NAME", "training_8cn2")

# A complete URL overrides the five settings above. LMS_DATABASE_URL wins over DATABASE_URL.
# Accepted forms: postgresql://user:pass@host/db, postgres://..., postgresql+psycopg://...
# (the automated tests set LMS_DATABASE_URL to a temporary SQLite file).
DATABASE_URL_OVERRIDE = (
    os.getenv("LMS_DATABASE_URL", "").strip() or os.getenv("DATABASE_URL", "").strip()
)

# Optional TLS mode: disable | allow | prefer | require | verify-ca | verify-full.
# Render's *internal* database URL needs none; its *external* URL needs "require".
DB_SSLMODE = os.getenv("LMS_DB_SSLMODE", "").strip()
# How long to keep retrying while the database server is still starting up.
DB_WAIT_SECONDS = int(os.getenv("LMS_DB_WAIT_SECONDS", "60"))

# Optional: create the first administrator on startup when no admin exists yet.
# Useful on hosts without a shell (e.g. Render free plan).
ADMIN_EMAIL = os.getenv("LMS_ADMIN_EMAIL", "").strip().lower()
ADMIN_PASSWORD = os.getenv("LMS_ADMIN_PASSWORD", "")
ADMIN_NAME = os.getenv("LMS_ADMIN_NAME", "Administrator").strip() or "Administrator"

UPLOAD_DIR = Path(os.getenv("LMS_UPLOAD_DIR", str(BASE_DIR / "uploads")))
MAX_UPLOAD_MB = int(os.getenv("LMS_MAX_UPLOAD_MB", "10"))

# Create demo users/courses on first start when the database is empty.
# Set LMS_AUTO_SEED=0 in production.
AUTO_SEED = os.getenv("LMS_AUTO_SEED", "1") != "0"

# Only needed if the frontend is served from a different origin.
CORS_ORIGINS = [
    o.strip() for o in os.getenv("LMS_CORS_ORIGINS", "").split(",") if o.strip()
]
