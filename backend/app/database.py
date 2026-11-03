"""PostgreSQL connection (SQLAlchemy 2 + psycopg 3).

Settings (see config.py), in order of priority:
  1. LMS_DATABASE_URL or DATABASE_URL: a full URL (Render provides DATABASE_URL)
  2. LMS_DB_HOST / LMS_DB_PORT / LMS_DB_USER / LMS_DB_PASSWORD / LMS_DB_NAME
"""
import time

from sqlalchemy import create_engine, text
from sqlalchemy.engine import URL, make_url
from sqlalchemy.exc import OperationalError
from sqlalchemy.orm import DeclarativeBase, sessionmaker

from . import config

DRIVER = "postgresql+psycopg"


def normalize_url(raw: str) -> str:
    """Hosting platforms hand out postgres:// or postgresql:// URLs. SQLAlchemy needs a
    driver name (and rejects the old 'postgres://' scheme), so add it."""
    raw = raw.strip()
    for prefix in ("postgres://", "postgresql://"):
        if raw.startswith(prefix):
            return f"{DRIVER}://" + raw[len(prefix):]
    return raw


def build_url() -> URL:
    """The URL the application connects to."""
    if config.DATABASE_URL_OVERRIDE:
        url = make_url(normalize_url(config.DATABASE_URL_OVERRIDE))
    else:
        # URL.create escapes special characters (@ : / #) in the password for us.
        url = URL.create(
            DRIVER,
            username=config.DB_USER,
            password=config.DB_PASSWORD or None,
            host=config.DB_HOST,
            port=config.DB_PORT,
            database=config.DB_NAME,
        )
    if config.DB_SSLMODE and url.get_backend_name() == "postgresql":
        url = url.update_query_dict({"sslmode": config.DB_SSLMODE})
    return url


DATABASE_URL = build_url()
IS_POSTGRES = DATABASE_URL.get_backend_name() == "postgresql"
IS_SQLITE = DATABASE_URL.get_backend_name() == "sqlite"

engine_options = {}
if IS_POSTGRES:
    engine_options.update(
        pool_pre_ping=True,  # drop connections the server closed while idle
        pool_recycle=1800,
        pool_size=5,  # small: managed/free Postgres plans allow few connections
        max_overflow=5,
    )
elif IS_SQLITE:
    engine_options["connect_args"] = {"check_same_thread": False}

engine = create_engine(DATABASE_URL, **engine_options)
SessionLocal = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)


class Base(DeclarativeBase):
    pass


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


# ---------------------------------------------------------------- startup helpers
INVALID_CATALOG = "3D000"  # SQLSTATE: the database does not exist


def _sqlstate(exc: OperationalError):
    return getattr(exc.orig, "sqlstate", None)


def wait_for_server(seconds: int | None = None, sleep=time.sleep, clock=time.monotonic) -> None:
    """Retry while the database server is still booting (a deploy starts services together).

    Only connection-level failures are retried (no SQLSTATE: refused, timeout, DNS, or
    57P03 'starting up'). Wrong password, missing database etc. fail immediately.
    """
    if not IS_POSTGRES:
        return
    limit = config.DB_WAIT_SECONDS if seconds is None else seconds
    deadline = clock() + limit
    probe = create_engine(DATABASE_URL)
    announced = False
    try:
        while True:
            try:
                with probe.connect():
                    return
            except OperationalError as exc:
                state = _sqlstate(exc)
                if state == INVALID_CATALOG:
                    return  # the server is up; ensure_database() creates the database
                retryable = state is None or state == "57P03"
                if not retryable or clock() >= deadline:
                    raise
                if not announced:
                    print(f"[LMS] PostgreSQL at {DATABASE_URL.host}:{DATABASE_URL.port or 5432} is not ready yet, waiting up to {limit}s...")
                    announced = True
                sleep(2)
    finally:
        probe.dispose()


def ensure_database() -> None:
    """Create the database if it does not exist (local/dev convenience).

    Hosted databases (Render, ...) are created for you, so normally this does nothing.
    It connects to the 'postgres' maintenance database and needs the CREATEDB privilege.
    """
    if not IS_POSTGRES or not DATABASE_URL.database:
        return
    probe = create_engine(DATABASE_URL)
    try:
        with probe.connect():
            return  # already exists
    except OperationalError as exc:
        if _sqlstate(exc) != INVALID_CATALOG:
            raise
    finally:
        probe.dispose()

    name = DATABASE_URL.database
    admin = create_engine(DATABASE_URL.set(database="postgres"), isolation_level="AUTOCOMMIT")
    try:
        with admin.connect() as conn:
            quoted = '"' + name.replace('"', '""') + '"'
            conn.execute(text(f"CREATE DATABASE {quoted}"))
        print(f"[LMS] Created database '{name}'.")
    except Exception as exc:
        raise RuntimeError(
            f"Database '{name}' does not exist and could not be created automatically "
            f"({exc.__class__.__name__}). Create it yourself:  CREATE DATABASE {name};"
        ) from exc
    finally:
        admin.dispose()


def init_db() -> None:
    """Make sure the database and all tables exist. Safe to call on every start."""
    from . import models  # noqa: F401  (registers the tables on Base.metadata)

    wait_for_server()
    ensure_database()
    Base.metadata.create_all(engine)
