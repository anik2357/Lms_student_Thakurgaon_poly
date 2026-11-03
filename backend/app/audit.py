from .models import AuditLog


def log(db, user, action: str, detail: str = "") -> None:
    """Add an audit entry to the session (the caller commits)."""
    db.add(
        AuditLog(
            user_id=getattr(user, "id", None),
            actor=getattr(user, "name", None) or "system",
            action=action,
            detail=detail[:2000],
        )
    )
