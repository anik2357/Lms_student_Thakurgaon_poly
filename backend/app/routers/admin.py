from datetime import timedelta

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from .. import files
from ..audit import log
from ..database import get_db
from ..deps import get_or_404
from ..models import (
    AuditLog,
    Course,
    Enrollment,
    QuizAttempt,
    Submission,
    User,
)
from ..schemas import AdminUserCreate, AdminUserUpdate, CourseStatusIn
from ..security import hash_password, require_roles
from ..serializers import course_out, user_out
from ..utils import iso, utcnow

router = APIRouter(prefix="/admin", tags=["admin"])
ROLES = ("student", "teacher", "admin")
COURSE_STATUSES = ("draft", "pending", "published", "archived")
AdminOnly = require_roles("admin")


@router.get("/stats")
def stats(admin: User = Depends(AdminOnly), db: Session = Depends(get_db)):
    by_role = dict(db.execute(select(User.role, func.count(User.id)).group_by(User.role)).all())
    by_status = dict(db.execute(select(Course.status, func.count(Course.id)).group_by(Course.status)).all())
    pending_teachers = (
        db.scalar(
            select(func.count(User.id)).where(User.role == "teacher", User.is_active.is_(False))
        )
        or 0
    )

    since = utcnow() - timedelta(days=6)
    recent = db.scalars(select(User.created_at).where(User.created_at >= since.replace(hour=0, minute=0, second=0, microsecond=0)))
    per_day = {}
    for created in recent:
        per_day[created.date()] = per_day.get(created.date(), 0) + 1
    today = utcnow().date()
    signups = []
    for i in range(6, -1, -1):
        day = today - timedelta(days=i)
        signups.append({"date": day.isoformat(), "count": per_day.get(day, 0)})

    return {
        "users": {
            "total": sum(by_role.values()),
            **{r: by_role.get(r, 0) for r in ROLES},
            "pending_teachers": pending_teachers,
        },
        "courses": {"total": sum(by_status.values()), **{s: by_status.get(s, 0) for s in COURSE_STATUSES}},
        "enrollments": db.scalar(select(func.count(Enrollment.id))) or 0,
        "submissions": db.scalar(select(func.count(Submission.id))) or 0,
        "quiz_attempts": db.scalar(select(func.count(QuizAttempt.id))) or 0,
        "signups": signups,
    }


# ---------------------------------------------------------------- users
@router.get("/users")
def list_users(
    search: str = "",
    role: str = "",
    status: str = "",
    page: int = Query(1, ge=1),
    limit: int = Query(15, ge=1, le=100),
    admin: User = Depends(AdminOnly),
    db: Session = Depends(get_db),
):
    q = select(User)
    if search.strip():
        like = f"%{search.strip()}%"
        q = q.where(or_(User.name.ilike(like), User.email.ilike(like)))
    if role in ROLES:
        q = q.where(User.role == role)
    if status == "inactive":
        q = q.where(User.is_active.is_(False))
    elif status == "active":
        q = q.where(User.is_active.is_(True))
    total = db.scalar(select(func.count()).select_from(q.subquery())) or 0
    rows = db.scalars(q.order_by(User.created_at.desc(), User.id.desc()).offset((page - 1) * limit).limit(limit)).all()
    return {"items": [user_out(u) for u in rows], "total": total, "page": page, "limit": limit}


@router.post("/users", status_code=201)
def create_user(data: AdminUserCreate, admin: User = Depends(AdminOnly), db: Session = Depends(get_db)):
    email = data.email.lower()
    if db.scalar(select(User).where(User.email == email)):
        raise HTTPException(409, "An account with this email already exists")
    user = User(name=data.name, email=email, password_hash=hash_password(data.password), role=data.role)
    db.add(user)
    db.flush()
    log(db, admin, "admin.user.create", f"{user.email} as {user.role}")
    db.commit()
    return user_out(user)


@router.put("/users/{user_id}")
def update_user(
    user_id: int, data: AdminUserUpdate, admin: User = Depends(AdminOnly), db: Session = Depends(get_db)
):
    user = get_or_404(db, User, user_id, "User")
    if user.id == admin.id and (
        (data.role is not None and data.role != "admin") or data.is_active is False
    ):
        raise HTTPException(400, "You cannot remove your own admin access or deactivate yourself")

    changes = []
    if data.name is not None and data.name != user.name:
        user.name = data.name
        changes.append("name")
    if data.role is not None and data.role != user.role:
        changes.append(f"role {user.role} -> {data.role}")
        user.role = data.role
    if data.is_active is not None and data.is_active != user.is_active:
        user.is_active = data.is_active
        changes.append("activated" if data.is_active else "deactivated")
    if data.password is not None:
        user.password_hash = hash_password(data.password)
        changes.append("password reset")
    if changes:
        log(db, admin, "admin.user.update", f"{user.email}: {', '.join(changes)}")
    db.commit()
    return user_out(user)


@router.delete("/users/{user_id}", status_code=204)
def delete_user(user_id: int, admin: User = Depends(AdminOnly), db: Session = Depends(get_db)):
    user = get_or_404(db, User, user_id, "User")
    if user.id == admin.id:
        raise HTTPException(400, "You cannot delete your own account")
    stored = files.user_files(user)
    log(db, admin, "admin.user.delete", f"{user.email} ({user.role})")
    db.delete(user)
    db.commit()
    files.remove_stored(*stored)


# -------------------------------------------------------------- courses
@router.get("/courses")
def list_courses(
    status: str = "",
    search: str = "",
    page: int = Query(1, ge=1),
    limit: int = Query(15, ge=1, le=100),
    admin: User = Depends(AdminOnly),
    db: Session = Depends(get_db),
):
    q = select(Course)
    if status in COURSE_STATUSES:
        q = q.where(Course.status == status)
    if search.strip():
        q = q.where(Course.title.ilike(f"%{search.strip()}%"))
    total = db.scalar(select(func.count()).select_from(q.subquery())) or 0
    rows = db.scalars(
        q.order_by(Course.created_at.desc(), Course.id.desc()).offset((page - 1) * limit).limit(limit)
    ).all()
    return {"items": [course_out(c) for c in rows], "total": total, "page": page, "limit": limit}


@router.put("/courses/{course_id}/status")
def set_course_status(
    course_id: int, data: CourseStatusIn, admin: User = Depends(AdminOnly), db: Session = Depends(get_db)
):
    c = get_or_404(db, Course, course_id, "Course")
    if c.status != data.status:
        log(db, admin, "admin.course.status", f"#{c.id} {c.title}: {c.status} -> {data.status}")
        c.status = data.status
        db.commit()
    return course_out(c)


# ------------------------------------------------------------ audit log
@router.get("/audit-log")
def audit_log(
    page: int = Query(1, ge=1),
    limit: int = Query(25, ge=1, le=100),
    admin: User = Depends(AdminOnly),
    db: Session = Depends(get_db),
):
    total = db.scalar(select(func.count(AuditLog.id))) or 0
    rows = db.scalars(
        select(AuditLog).order_by(AuditLog.id.desc()).offset((page - 1) * limit).limit(limit)
    ).all()
    return {
        "items": [
            {
                "id": r.id,
                "actor": r.actor,
                "action": r.action,
                "detail": r.detail,
                "created_at": iso(r.created_at),
            }
            for r in rows
        ],
        "total": total,
        "page": page,
        "limit": limit,
    }
