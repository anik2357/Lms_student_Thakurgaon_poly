"""Unit tests for the PostgreSQL connection helpers (no database server needed)."""
import types

import pytest
from sqlalchemy.engine import make_url
from sqlalchemy.exc import OperationalError

from app import config, database


class DriverError(Exception):
    """Stands in for psycopg's error; real ones carry the SQLSTATE in .sqlstate."""

    def __init__(self, sqlstate=None):
        super().__init__("driver error")
        self.sqlstate = sqlstate


def op_error(sqlstate=None):
    return OperationalError("connect", {}, DriverError(sqlstate))


class FakeConn:
    def __init__(self, executed):
        self.executed = executed

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False

    def execute(self, statement):
        self.executed.append(str(statement))


def fake_create_engine(script, created, executed):
    """script: one outcome per connect() call. None = success, an exception = raise it."""

    def create_engine(url, **kwargs):
        created.append((url, kwargs))
        engine = types.SimpleNamespace()

        def connect():
            outcome = script.pop(0)
            if outcome is not None:
                raise outcome
            return FakeConn(executed)

        engine.connect = connect
        engine.dispose = lambda: None
        return engine

    return create_engine


def use_postgres(monkeypatch, script):
    created, executed = [], []
    monkeypatch.setattr(database, "IS_POSTGRES", True)
    monkeypatch.setattr(database, "DATABASE_URL", make_url("postgresql+psycopg://u:p@db.example:5432/lms"))
    monkeypatch.setattr(database, "create_engine", fake_create_engine(script, created, executed))
    return created, executed


class Clock:
    """Fake time: sleeping advances the clock instantly."""

    def __init__(self):
        self.now = 0.0
        self.sleeps = []

    def time(self):
        return self.now

    def sleep(self, seconds):
        self.sleeps.append(seconds)
        self.now += seconds


# ------------------------------------------------------------------ URLs
def test_normalize_url_adds_the_driver():
    n = database.normalize_url
    assert n("postgres://u:p@h:5432/db") == "postgresql+psycopg://u:p@h:5432/db"
    assert n("postgresql://u:p@h/db") == "postgresql+psycopg://u:p@h/db"
    assert n("  postgres://u:p@h/db \n") == "postgresql+psycopg://u:p@h/db"
    assert n("postgresql+psycopg2://u:p@h/db") == "postgresql+psycopg2://u:p@h/db"  # explicit driver kept
    assert n("sqlite:///x.db") == "sqlite:///x.db"


def test_build_url_from_separate_settings(monkeypatch):
    monkeypatch.setattr(config, "DATABASE_URL_OVERRIDE", "")
    monkeypatch.setattr(config, "DB_SSLMODE", "")
    monkeypatch.setattr(config, "DB_HOST", "db.example")
    monkeypatch.setattr(config, "DB_PORT", 5433)
    monkeypatch.setattr(config, "DB_USER", "lms")
    monkeypatch.setattr(config, "DB_PASSWORD", "p@ss:w/rd#1")
    monkeypatch.setattr(config, "DB_NAME", "school")
    url = database.build_url()
    assert url.drivername == "postgresql+psycopg"
    assert (url.host, url.port, url.database, url.username) == ("db.example", 5433, "school", "lms")
    assert url.password == "p@ss:w/rd#1"  # special characters survive


def test_build_url_accepts_a_render_style_url(monkeypatch):
    monkeypatch.setattr(config, "DATABASE_URL_OVERRIDE", "postgres://lms:secret@dpg-abc-a/lms_db")
    monkeypatch.setattr(config, "DB_SSLMODE", "")
    url = database.build_url()
    assert url.drivername == "postgresql+psycopg"
    assert (url.host, url.database, url.password) == ("dpg-abc-a", "lms_db", "secret")


def test_sslmode_is_added_to_postgres_urls_only(monkeypatch):
    monkeypatch.setattr(config, "DB_SSLMODE", "require")
    monkeypatch.setattr(config, "DATABASE_URL_OVERRIDE", "postgres://u:p@h/db")
    assert database.build_url().query["sslmode"] == "require"
    monkeypatch.setattr(config, "DATABASE_URL_OVERRIDE", "sqlite:///x.db")
    assert "sslmode" not in database.build_url().query


# ------------------------------------------------------- waiting for the server
def test_wait_retries_until_the_server_accepts_connections(monkeypatch):
    created, _ = use_postgres(monkeypatch, [op_error(None), op_error("57P03"), None])
    clock = Clock()
    database.wait_for_server(seconds=30, sleep=clock.sleep, clock=clock.time)
    assert len(clock.sleeps) == 2
    assert len(created) == 1


def test_wait_fails_at_once_on_a_wrong_password(monkeypatch):
    use_postgres(monkeypatch, [op_error("28P01")])
    clock = Clock()
    with pytest.raises(OperationalError):
        database.wait_for_server(seconds=30, sleep=clock.sleep, clock=clock.time)
    assert clock.sleeps == []


def test_wait_gives_up_after_the_time_limit(monkeypatch):
    use_postgres(monkeypatch, [op_error(None)] * 50)
    clock = Clock()
    with pytest.raises(OperationalError):
        database.wait_for_server(seconds=6, sleep=clock.sleep, clock=clock.time)
    assert clock.now >= 6


def test_wait_returns_when_only_the_database_is_missing(monkeypatch):
    use_postgres(monkeypatch, [op_error("3D000")])
    clock = Clock()
    database.wait_for_server(seconds=30, sleep=clock.sleep, clock=clock.time)
    assert clock.sleeps == []


# ----------------------------------------------------------- creating the database
def test_ensure_database_does_nothing_when_it_exists(monkeypatch):
    created, executed = use_postgres(monkeypatch, [None])
    database.ensure_database()
    assert len(created) == 1 and executed == []


def test_ensure_database_creates_a_missing_database(monkeypatch):
    created, executed = use_postgres(monkeypatch, [op_error("3D000"), None])
    database.ensure_database()
    assert executed == ['CREATE DATABASE "lms"']
    url, kwargs = created[1]
    assert url.database == "postgres" and kwargs["isolation_level"] == "AUTOCOMMIT"


def test_ensure_database_reports_other_errors(monkeypatch):
    use_postgres(monkeypatch, [op_error("28P01")])
    with pytest.raises(OperationalError):
        database.ensure_database()
