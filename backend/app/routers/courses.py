from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile
from fastapi.responses import FileResponse
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from .. import files
from ..audit import log
from ..database import get_db
from ..deps import (
    ACCESS_STATUSES,
    can_access,
    can_manage,
    get_or_404,
    is_enrolled,
    progress_for,
    require_access,
    require_manage,
)
from ..models import (
    Announcement,
    Assignment,
    Course,
    Enrollment,
    Lesson,
    LessonProgress,
    Material,
    QuizAttempt,
    Submission,
    User,
)
from ..schemas import AnnouncementIn, CourseIn, LessonIn, ReorderIn
from ..security import get_current_user, require_roles
from ..serializers import (
    announcement_out,
    assignment_out,
    course_out,
    lesson_out,
    quiz_summary,
)
from ..utils import iso, utcnow

router = APIRouter(tags=["courses"])

STAFF = ("teacher", "admin")


# ======================================================================
# Catalog and course detail
# ======================================================================
@router.get("/courses")
def catalog(
    search: str = "",
    category: str = "",
    page: int = Query(1, ge=1),
    limit: int = Query(12, ge=1, le=50),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    q = select(Course).where(Course.status == "published")
    if search.strip():
        like = f"%{search.strip()}%"
        q = q.where(or_(Course.title.ilike(like), Course.description.ilike(like)))
    if category:
        q = q.where(Course.category == category)
    total = db.scalar(select(func.count()).select_from(q.subquery())) or 0
    items = db.scalars(
        q.order_by(Course.created_at.desc(), Course.id.desc()).offset((page - 1) * limit).limit(limit)
    ).all()
    enrolled = set(db.scalars(select(Enrollment.course_id).where(Enrollment.student_id == user.id)))
    return {
        "items": [course_out(c, enrolled=c.id in enrolled) for c in items],
        "total": total,
        "page": page,
        "limit": limit,
    }


@router.get("/categories")
def categories(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return list(
        db.scalars(
            select(Course.category).where(Course.status == "published").distinct().order_by(Course.category)
        )
    )


@router.get("/courses/{course_id}")
def course_detail(course_id: int, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    c = get_or_404(db, Course, course_id, "Course")
    access = can_access(db, user, c)
    if not access and c.status != "published":
        raise HTTPException(404, "Course not found")

    is_student = user.role == "student"
    out = course_out(c, enrolled=is_student and is_enrolled(db, user, c))
    out["has_access"] = access
    out["can_manage"] = can_manage(user, c)

    if not access:
        out["lessons"] = [lesson_out(l) for l in c.lessons]  # titles only
        return out

    manager = out["can_manage"]
    done, subs, attempts = set(), {}, {}
    if is_student:
        done = set(
            db.scalars(
                select(LessonProgress.lesson_id)
                .join(Lesson, Lesson.id == LessonProgress.lesson_id)
                .where(LessonProgress.student_id == user.id, Lesson.course_id == c.id)
            )
        )
        a_ids = [a.id for a in c.assignments]
        if a_ids:
            subs = {
                s.assignment_id: s
                for s in db.scalars(
                    select(Submission).where(
                        Submission.student_id == user.id, Submission.assignment_id.in_(a_ids)
                    )
                )
            }
        q_ids = [q.id for q in c.quizzes]
        if q_ids:
            for qa in db.scalars(
                select(QuizAttempt).where(QuizAttempt.student_id == user.id, QuizAttempt.quiz_id.in_(q_ids))
            ):
                stats = attempts.setdefault(qa.quiz_id, {"best": 0, "total": qa.total, "count": 0})
                stats["count"] += 1
                if qa.score >= stats["best"]:
                    stats["best"], stats["total"] = qa.score, qa.total

    out["lessons"] = [lesson_out(l, full=True, done=l.id in done) for l in c.lessons]
    out["assignments"] = [assignment_out(a, subs.get(a.id), manager=manager) for a in c.assignments]
    out["quizzes"] = [quiz_summary(q, attempts.get(q.id), manager=manager) for q in c.quizzes]
    out["announcements"] = [announcement_out(a) for a in c.announcements]
    if is_student:
        out["progress"] = progress_for(db, user.id, c)
    return out


# ======================================================================
# Student: enrollment and progress
# ======================================================================
@router.post("/courses/{course_id}/enroll", status_code=201)
def enroll(course_id: int, user: User = Depends(require_roles("student")), db: Session = Depends(get_db)):
    c = get_or_404(db, Course, course_id, "Course")
    if c.status != "published":
        raise HTTPException(404, "Course not found")
    if is_enrolled(db, user, c):
        raise HTTPException(409, "You are already enrolled in this course")
    db.add(Enrollment(student_id=user.id, course_id=c.id))
    db.commit()
    return {"ok": True}


@router.delete("/courses/{course_id}/enroll", status_code=204)
def unenroll(course_id: int, user: User = Depends(require_roles("student")), db: Session = Depends(get_db)):
    enrollment = db.scalar(
        select(Enrollment).where(Enrollment.student_id == user.id, Enrollment.course_id == course_id)
    )
    if enrollment is None:
        raise HTTPException(404, "You are not enrolled in this course")
    db.delete(enrollment)
    db.commit()


@router.get("/me/courses")
def my_courses(user: User = Depends(require_roles("student")), db: Session = Depends(get_db)):
    courses = db.scalars(
        select(Course)
        .join(Enrollment, Enrollment.course_id == Course.id)
        .where(Enrollment.student_id == user.id, Course.status.in_(ACCESS_STATUSES))
        .order_by(Enrollment.enrolled_at.desc())
    ).all()
    return [course_out(c, progress=progress_for(db, user.id, c), enrolled=True) for c in courses]


@router.get("/me/dashboard")
def student_dashboard(user: User = Depends(require_roles("student")), db: Session = Depends(get_db)):
    courses = db.scalars(
        select(Course)
        .join(Enrollment, Enrollment.course_id == Course.id)
        .where(Enrollment.student_id == user.id, Course.status.in_(ACCESS_STATUSES))
        .order_by(Enrollment.enrolled_at.desc())
    ).all()
    course_ids = [c.id for c in courses]
    out_courses = [course_out(c, progress=progress_for(db, user.id, c), enrolled=True) for c in courses]

    deadlines, pending, announcements, percents = [], 0, [], []
    if course_ids:
        submitted = set(db.scalars(select(Submission.assignment_id).where(Submission.student_id == user.id)))
        assignments = db.scalars(
            select(Assignment).where(Assignment.course_id.in_(course_ids)).order_by(Assignment.due_date)
        ).all()
        for a in assignments:
            if a.id in submitted:
                continue
            pending += 1
            if a.due_date is not None and len(deadlines) < 6:
                deadlines.append(
                    {
                        "assignment_id": a.id,
                        "title": a.title,
                        "course_id": a.course_id,
                        "course_title": a.course.title,
                        "due_date": iso(a.due_date),
                    }
                )
        announcements = [
            {**announcement_out(a), "course_title": a.course.title}
            for a in db.scalars(
                select(Announcement)
                .where(Announcement.course_id.in_(course_ids))
                .order_by(Announcement.created_at.desc())
                .limit(5)
            )
        ]
        for s in db.scalars(
            select(Submission).where(Submission.student_id == user.id, Submission.score.is_not(None))
        ):
            percents.append(s.score / s.assignment.max_score * 100)
        best = {}
        for qa in db.scalars(select(QuizAttempt).where(QuizAttempt.student_id == user.id)):
            if qa.total:
                best[qa.quiz_id] = max(best.get(qa.quiz_id, 0), qa.score / qa.total * 100)
        percents += list(best.values())

    avg_progress = round(sum(c["progress"] for c in out_courses) / len(out_courses)) if out_courses else 0
    avg_grade = round(sum(percents) / len(percents)) if percents else None
    return {
        "courses": out_courses,
        "deadlines": deadlines,
        "announcements": announcements,
        "stats": {
            "enrolled": len(out_courses),
            "avg_progress": avg_progress,
            "pending_assignments": pending,
            "avg_grade": avg_grade,
        },
    }


@router.post("/lessons/{lesson_id}/complete")
def complete_lesson(lesson_id: int, user: User = Depends(require_roles("student")), db: Session = Depends(get_db)):
    lesson = get_or_404(db, Lesson, lesson_id, "Lesson")
    require_access(db, user, lesson.course)
    exists = db.scalar(
        select(LessonProgress.id).where(
            LessonProgress.student_id == user.id, LessonProgress.lesson_id == lesson.id
        )
    )
    if exists is None:
        db.add(LessonProgress(student_id=user.id, lesson_id=lesson.id))
        db.commit()
    return {"progress": progress_for(db, user.id, lesson.course)}


@router.delete("/lessons/{lesson_id}/complete")
def uncomplete_lesson(lesson_id: int, user: User = Depends(require_roles("student")), db: Session = Depends(get_db)):
    lesson = get_or_404(db, Lesson, lesson_id, "Lesson")
    row = db.scalar(
        select(LessonProgress).where(
            LessonProgress.student_id == user.id, LessonProgress.lesson_id == lesson.id
        )
    )
    if row is not None:
        db.delete(row)
        db.commit()
    return {"progress": progress_for(db, user.id, lesson.course)}


# ======================================================================
# Teacher / admin: course management
# ======================================================================
@router.get("/teacher/courses")
def teacher_courses(user: User = Depends(require_roles(*STAFF)), db: Session = Depends(get_db)):
    courses = db.scalars(
        select(Course).where(Course.teacher_id == user.id).order_by(Course.created_at.desc(), Course.id.desc())
    ).all()
    return [course_out(c) for c in courses]


@router.post("/courses", status_code=201)
def create_course(data: CourseIn, user: User = Depends(require_roles(*STAFF)), db: Session = Depends(get_db)):
    c = Course(title=data.title, description=data.description, category=data.category, teacher_id=user.id)
    db.add(c)
    db.flush()
    log(db, user, "course.create", f"#{c.id} {c.title}")
    db.commit()
    return course_out(c)


@router.put("/courses/{course_id}")
def update_course(
    course_id: int, data: CourseIn, user: User = Depends(require_roles(*STAFF)), db: Session = Depends(get_db)
):
    c = get_or_404(db, Course, course_id, "Course")
    require_manage(user, c)
    c.title, c.description, c.category = data.title, data.description, data.category
    db.commit()
    return course_out(c)


@router.post("/courses/{course_id}/submit-review")
def submit_for_review(course_id: int, user: User = Depends(require_roles(*STAFF)), db: Session = Depends(get_db)):
    c = get_or_404(db, Course, course_id, "Course")
    require_manage(user, c)
    if c.status != "draft":
        raise HTTPException(400, "Only draft courses can be submitted for review")
    if not c.lessons:
        raise HTTPException(400, "Add at least one lesson before submitting for review")
    c.status = "pending"
    log(db, user, "course.submit_review", f"#{c.id} {c.title}")
    db.commit()
    return course_out(c)


@router.delete("/courses/{course_id}", status_code=204)
def delete_course(course_id: int, user: User = Depends(require_roles(*STAFF)), db: Session = Depends(get_db)):
    c = get_or_404(db, Course, course_id, "Course")
    require_manage(user, c)
    stored = files.course_files(c)
    log(db, user, "course.delete", f"#{c.id} {c.title}")
    db.delete(c)
    db.commit()
    files.remove_stored(*stored)


@router.get("/courses/{course_id}/students")
def course_students(course_id: int, user: User = Depends(require_roles(*STAFF)), db: Session = Depends(get_db)):
    c = get_or_404(db, Course, course_id, "Course")
    require_manage(user, c)
    done = dict(
        db.execute(
            select(LessonProgress.student_id, func.count(LessonProgress.id))
            .join(Lesson, Lesson.id == LessonProgress.lesson_id)
            .where(Lesson.course_id == c.id)
            .group_by(LessonProgress.student_id)
        ).all()
    )
    total = len(c.lessons)
    return [
        {
            "id": e.student.id,
            "name": e.student.name,
            "email": e.student.email,
            "enrolled_at": iso(e.enrolled_at),
            "progress": round(done.get(e.student_id, 0) / total * 100) if total else 0,
        }
        for e in sorted(c.enrollments, key=lambda e: e.student.name.lower())
    ]


# ======================================================================
# Lessons and materials
# ======================================================================
@router.post("/courses/{course_id}/lessons", status_code=201)
def add_lesson(
    course_id: int, data: LessonIn, user: User = Depends(require_roles(*STAFF)), db: Session = Depends(get_db)
):
    c = get_or_404(db, Course, course_id, "Course")
    require_manage(user, c)
    nxt = (db.scalar(select(func.max(Lesson.order_index)).where(Lesson.course_id == c.id)) or 0) + 1
    lesson = Lesson(
        course_id=c.id, title=data.title, content=data.content, video_url=data.video_url, order_index=nxt
    )
    db.add(lesson)
    db.commit()
    return lesson_out(lesson, full=True)


@router.post("/courses/{course_id}/lessons/reorder")
def reorder_lessons(
    course_id: int, data: ReorderIn, user: User = Depends(require_roles(*STAFF)), db: Session = Depends(get_db)
):
    c = get_or_404(db, Course, course_id, "Course")
    require_manage(user, c)
    current = {l.id: l for l in c.lessons}
    if sorted(data.ids) != sorted(current):
        raise HTTPException(400, "The list must contain every lesson of the course exactly once")
    for position, lesson_id in enumerate(data.ids, start=1):
        current[lesson_id].order_index = position
    db.commit()
    return {"ok": True}


@router.put("/lessons/{lesson_id}")
def update_lesson(
    lesson_id: int, data: LessonIn, user: User = Depends(require_roles(*STAFF)), db: Session = Depends(get_db)
):
    lesson = get_or_404(db, Lesson, lesson_id, "Lesson")
    require_manage(user, lesson.course)
    lesson.title, lesson.content, lesson.video_url = data.title, data.content, data.video_url
    db.commit()
    return lesson_out(lesson, full=True)


@router.delete("/lessons/{lesson_id}", status_code=204)
def delete_lesson(lesson_id: int, user: User = Depends(require_roles(*STAFF)), db: Session = Depends(get_db)):
    lesson = get_or_404(db, Lesson, lesson_id, "Lesson")
    require_manage(user, lesson.course)
    stored = files.lesson_files(lesson)
    db.delete(lesson)
    db.commit()
    files.remove_stored(*stored)


@router.post("/lessons/{lesson_id}/materials", status_code=201)
async def upload_material(
    lesson_id: int,
    file: UploadFile = File(...),
    user: User = Depends(require_roles(*STAFF)),
    db: Session = Depends(get_db),
):
    lesson = get_or_404(db, Lesson, lesson_id, "Lesson")
    require_manage(user, lesson.course)
    original, stored = await files.save_upload(file, "materials")
    material = Material(lesson_id=lesson.id, filename=original, stored_name=stored)
    db.add(material)
    db.commit()
    return {"id": material.id, "filename": material.filename}


@router.get("/materials/{material_id}/download")
def download_material(material_id: int, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    material = get_or_404(db, Material, material_id, "File")
    require_access(db, user, material.lesson.course)
    return FileResponse(files.path_for(material.stored_name), filename=material.filename)


@router.delete("/materials/{material_id}", status_code=204)
def delete_material(material_id: int, user: User = Depends(require_roles(*STAFF)), db: Session = Depends(get_db)):
    material = get_or_404(db, Material, material_id, "File")
    require_manage(user, material.lesson.course)
    stored = material.stored_name
    db.delete(material)
    db.commit()
    files.remove_stored(stored)


# ======================================================================
# Announcements
# ======================================================================
@router.post("/courses/{course_id}/announcements", status_code=201)
def post_announcement(
    course_id: int,
    data: AnnouncementIn,
    user: User = Depends(require_roles(*STAFF)),
    db: Session = Depends(get_db),
):
    c = get_or_404(db, Course, course_id, "Course")
    require_manage(user, c)
    a = Announcement(course_id=c.id, author_id=user.id, message=data.message, created_at=utcnow())
    db.add(a)
    db.commit()
    return announcement_out(a)


@router.delete("/announcements/{announcement_id}", status_code=204)
def delete_announcement(
    announcement_id: int, user: User = Depends(require_roles(*STAFF)), db: Session = Depends(get_db)
):
    a = get_or_404(db, Announcement, announcement_id, "Announcement")
    require_manage(user, a.course)
    db.delete(a)
    db.commit()
