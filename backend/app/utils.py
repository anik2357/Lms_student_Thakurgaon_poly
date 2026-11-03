from datetime import datetime, timezone


def utcnow() -> datetime:
    """Naive UTC 'now' (all datetimes are stored as naive UTC)."""
    return datetime.now(timezone.utc).replace(tzinfo=None)


def iso(dt):
    """Serialize a naive-UTC datetime so JavaScript parses it as UTC."""
    return dt.isoformat() + "Z" if dt else None


def to_naive_utc(dt):
    if dt is None:
        return None
    if dt.tzinfo is not None:
        dt = dt.astimezone(timezone.utc).replace(tzinfo=None)
    return dt
