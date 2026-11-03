from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..audit import log
from ..database import get_db
from ..models import User
from ..schemas import LoginIn, PasswordChangeIn, ProfileIn, RegisterIn
from ..security import (
    check_rate_limit,
    create_token,
    get_current_user,
    hash_password,
    reset_rate_limit,
    verify_password,
)
from ..serializers import user_out

router = APIRouter(prefix="/auth", tags=["auth"])


def _session(user):
    return {"access_token": create_token(user), "token_type": "bearer", "user": user_out(user)}


@router.post("/register", status_code=201)
def register(data: RegisterIn, db: Session = Depends(get_db)):
    email = data.email.lower()
    if db.scalar(select(User).where(User.email == email)):
        raise HTTPException(409, "An account with this email already exists")

    # Teacher accounts stay inactive until an administrator approves them.
    user = User(
        name=data.name,
        email=email,
        password_hash=hash_password(data.password),
        role=data.role,
        is_active=(data.role == "student"),
    )
    db.add(user)
    db.flush()
    log(db, user, "user.register", f"{user.email} registered as {user.role}")
    db.commit()

    if not user.is_active:
        return {
            "pending_approval": True,
            "message": "Your teacher account was created and is waiting for administrator approval.",
        }
    return {"pending_approval": False, **_session(user)}


@router.post("/login")
def login(data: LoginIn, request: Request, db: Session = Depends(get_db)):
    email = data.email.lower()
    client = request.client.host if request.client else "unknown"
    key = f"{client}:{email}"
    check_rate_limit(key)

    user = db.scalar(select(User).where(User.email == email))
    if user is None or not verify_password(data.password, user.password_hash):
        raise HTTPException(401, "Incorrect email or password")
    if not user.is_active:
        if user.role == "teacher":
            raise HTTPException(403, "Your account is waiting for administrator approval")
        raise HTTPException(403, "This account has been deactivated")

    reset_rate_limit(key)
    return _session(user)


@router.get("/me")
def me(user: User = Depends(get_current_user)):
    return user_out(user)


@router.put("/me")
def update_profile(data: ProfileIn, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    user.name = data.name
    db.commit()
    return user_out(user)


@router.post("/change-password")
def change_password(
    data: PasswordChangeIn, user: User = Depends(get_current_user), db: Session = Depends(get_db)
):
    if not verify_password(data.current_password, user.password_hash):
        raise HTTPException(400, "Current password is incorrect")
    user.password_hash = hash_password(data.new_password)
    log(db, user, "user.password_change", user.email)
    db.commit()
    return {"ok": True}
