import time
from datetime import datetime, timedelta, timezone

import bcrypt
import jwt
from fastapi import Depends, HTTPException
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.orm import Session

from . import config
from .database import get_db
from .models import User

bearer = HTTPBearer(auto_error=False)


# ---------- passwords ----------
def _pw(password: str) -> bytes:
    return password.encode("utf-8")[:72]  # bcrypt only uses the first 72 bytes


def hash_password(password: str) -> str:
    return bcrypt.hashpw(_pw(password), bcrypt.gensalt()).decode("utf-8")


def verify_password(password: str, hashed: str) -> bool:
    try:
        return bcrypt.checkpw(_pw(password), hashed.encode("utf-8"))
    except ValueError:
        return False


# ---------- tokens ----------
def create_token(user: User) -> str:
    payload = {
        "sub": str(user.id),
        "exp": datetime.now(timezone.utc) + timedelta(minutes=config.TOKEN_MINUTES),
    }
    return jwt.encode(payload, config.SECRET_KEY, algorithm=config.ALGORITHM)


def get_current_user(
    creds: HTTPAuthorizationCredentials = Depends(bearer),
    db: Session = Depends(get_db),
) -> User:
    if creds is None:
        raise HTTPException(401, "Not authenticated")
    try:
        data = jwt.decode(creds.credentials, config.SECRET_KEY, algorithms=[config.ALGORITHM])
        user_id = int(data["sub"])
    except (jwt.PyJWTError, KeyError, ValueError):
        raise HTTPException(401, "Invalid or expired session, please sign in again")
    user = db.get(User, user_id)
    # The role is read from the database on every request, so role changes
    # and deactivation by an admin take effect immediately.
    if user is None or not user.is_active:
        raise HTTPException(401, "This account is not available")
    return user


def require_roles(*roles: str):
    def dependency(user: User = Depends(get_current_user)) -> User:
        if user.role not in roles:
            raise HTTPException(403, "You do not have permission to do that")
        return user

    return dependency


# ---------- tiny in-memory login rate limiter ----------
_attempts: dict[str, list[float]] = {}


def check_rate_limit(key: str, limit: int = 10, window: int = 300) -> None:
    now = time.time()
    recent = [t for t in _attempts.get(key, []) if now - t < window]
    if len(recent) >= limit:
        _attempts[key] = recent
        raise HTTPException(429, "Too many sign-in attempts. Please wait a few minutes.")
    recent.append(now)
    _attempts[key] = recent


def reset_rate_limit(key: str) -> None:
    _attempts.pop(key, None)
