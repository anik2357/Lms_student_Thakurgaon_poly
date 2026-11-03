"""Shared lookups and permission checks."""
from fastapi import HTTPException
from sqlalchemy import func, select

from .models import Enrollment, Lesson, LessonProgress

ACCESS_STATUSES = ("published", "archived")


def get_or_404(db, model, obj_id, label=None):
    obj = db.get(model, obj_id)
    if obj is None:
        raise HTTPException(404, f"{label or model.__name__} not found")
    return obj


def can_manage(user, course) -> bool:
    """Admins manage everything; teachers manage their own courses."""
    return user.role == "admin" or (user.role == "teacher" and course.teacher_id == user.id)


def is_enrolled(db, user, course) -> bool:
    found = db.scalar(
        select(Enrollment.id).where(
            Enrollment.student_id == user.id, Enrollment.course_id == course.id
        )
    )
    return found is not None


def can_access(db, user, course) -> bool:
    if can_manage(user, course):
        return True
    return (
        user.role == "student"
        and course.status in ACCESS_STATUSES
        and is_enrolled(db, user, course)
    )


def require_manage(user, course) -> None:
    if not can_manage(user, course):
        raise HTTPException(403, "You can only manage your own courses")


def require_access(db, user, course) -> None:
    if not can_access(db, user, course):
        raise HTTPException(403, "Enroll in this course to access its content")


def progress_for(db, student_id: int, course) -> int:
    total = len(course.lessons)
    if not total:
        return 0
    done = db.scalar(
        select(func.count(LessonProgress.id))
        .join(Lesson, Lesson.id == LessonProgress.lesson_id)
        .where(LessonProgress.student_id == student_id, Lesson.course_id == course.id)
    )
    return round((done or 0) / total * 100)
