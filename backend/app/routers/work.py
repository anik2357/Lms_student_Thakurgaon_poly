"""Assignments, submissions, grading, quizzes and grade reports."""
from typing import Optional

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from .. import files
from ..database import get_db
from ..deps import can_manage, get_or_404, require_access, require_manage
from ..models import (
    Assignment,
    Course,
    Enrollment,
    Question,
    Quiz,
    QuizAttempt,
    Submission,
    User,
)
from ..schemas import AssignmentIn, AttemptIn, GradeIn, QuizIn
from ..security import get_current_user, require_roles
from ..serializers import assignment_out, course_out, quiz_out, submission_out
from ..utils import iso, to_naive_utc, utcnow

router = APIRouter(tags=["work"])
STAFF = ("teacher", "admin")


# ======================================================================
# Assignments
# ======================================================================
@router.post("/courses/{course_id}/assignments", status_code=201)
def create_assignment(
    course_id: int,
    data: AssignmentIn,
    user: User = Depends(require_roles(*STAFF)),
    db: Session = Depends(get_db),
):
    c = get_or_404(db, Course, course_id, "Course")
    require_manage(user, c)
    a = Assignment(
        course_id=c.id,
        title=data.title,
        description=data.description,
        due_date=to_naive_utc(data.due_date),
        max_score=data.max_score,
    )
    db.add(a)
    db.commit()
    return assignment_out(a, manager=True)


@router.put("/assignments/{assignment_id}")
def update_assignment(
    assignment_id: int,
    data: AssignmentIn,
    user: User = Depends(require_roles(*STAFF)),
    db: Session = Depends(get_db),
):
    a = get_or_404(db, Assignment, assignment_id, "Assignment")
    require_manage(user, a.course)
    a.title, a.description = data.title, data.description
    a.due_date, a.max_score = to_naive_utc(data.due_date), data.max_score
    db.commit()
    return assignment_out(a, manager=True)


@router.delete("/assignments/{assignment_id}", status_code=204)
def delete_assignment(
    assignment_id: int, user: User = Depends(require_roles(*STAFF)), db: Session = Depends(get_db)
):
    a = get_or_404(db, Assignment, assignment_id, "Assignment")
    require_manage(user, a.course)
    stored = files.assignment_files(a)
    db.delete(a)
    db.commit()
    files.remove_stored(*stored)


@router.get("/assignments/{assignment_id}")
def get_assignment(assignment_id: int, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    a = get_or_404(db, Assignment, assignment_id, "Assignment")
    c = a.course
    require_access(db, user, c)
    manager = can_manage(user, c)
    sub = None
    if user.role == "student":
        sub = db.scalar(
            select(Submission).where(Submission.assignment_id == a.id, Submission.student_id == user.id)
        )
    out = assignment_out(a, sub, manager=manager)
    out["course"] = {"id": c.id, "title": c.title}
    return out


@router.post("/assignments/{assignment_id}/submit")
async def submit_assignment(
    assignment_id: int,
    text: str = Form(""),
    file: Optional[UploadFile] = File(None),
    user: User = Depends(require_roles("student")),
    db: Session = Depends(get_db),
):
    a = get_or_404(db, Assignment, assignment_id, "Assignment")
    require_access(db, user, a.course)

    text = text.strip()
    has_file = file is not None and bool(file.filename)
    if not text and not has_file:
        raise HTTPException(400, "Write an answer or attach a file")
    if len(text) > 20000:
        raise HTTPException(400, "Your written answer is too long (20,000 characters max)")

    sub = db.scalar(
        select(Submission).where(Submission.assignment_id == a.id, Submission.student_id == user.id)
    )
    if sub is not None and sub.score is not None:
        raise HTTPException(400, "This submission has already been graded and can no longer be changed")

    original = stored = ""
    if has_file:
        original, stored = await files.save_upload(file, "submissions")

    old_file = None
    if sub is None:
        sub = Submission(assignment_id=a.id, student_id=user.id)
        db.add(sub)
    else:
        old_file = sub.stored_name
    sub.text = text
    if has_file:
        sub.filename, sub.stored_name = original, stored
    sub.submitted_at = utcnow()
    db.commit()
    if has_file and old_file:
        files.remove_stored(old_file)
    return submission_out(sub)


@router.get("/assignments/{assignment_id}/submissions")
def list_submissions(
    assignment_id: int, user: User = Depends(require_roles(*STAFF)), db: Session = Depends(get_db)
):
    a = get_or_404(db, Assignment, assignment_id, "Assignment")
    require_manage(user, a.course)
    subs = db.scalars(
        select(Submission).where(Submission.assignment_id == a.id).order_by(Submission.submitted_at.desc())
    ).all()
    info = assignment_out(a, manager=True)
    info["course"] = {"id": a.course.id, "title": a.course.title}
    return {
        "assignment": info,
        "submissions": [submission_out(s, with_student=True) for s in subs],
        "not_submitted": max(0, len(a.course.enrollments) - len(subs)),
    }


@router.put("/submissions/{submission_id}/grade")
def grade_submission(
    submission_id: int,
    data: GradeIn,
    user: User = Depends(require_roles(*STAFF)),
    db: Session = Depends(get_db),
):
    s = get_or_404(db, Submission, submission_id, "Submission")
    require_manage(user, s.assignment.course)
    if data.score > s.assignment.max_score:
        raise HTTPException(400, f"Score cannot be higher than {s.assignment.max_score}")
    s.score, s.feedback = data.score, data.feedback
    db.commit()
    return submission_out(s, with_student=True)


@router.get("/submissions/{submission_id}/file")
def submission_file(submission_id: int, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    s = get_or_404(db, Submission, submission_id, "Submission")
    if not (can_manage(user, s.assignment.course) or s.student_id == user.id):
        raise HTTPException(403, "You do not have permission to download this file")
    if not s.stored_name:
        raise HTTPException(404, "This submission has no attached file")
    return FileResponse(files.path_for(s.stored_name), filename=s.filename)


@router.get("/me/grades")
def my_grades(user: User = Depends(require_roles("student")), db: Session = Depends(get_db)):
    subs = db.scalars(
        select(Submission).where(Submission.student_id == user.id).order_by(Submission.submitted_at.desc())
    ).all()
    assignments = [
        {
            "submission_id": s.id,
            "assignment_id": s.assignment_id,
            "title": s.assignment.title,
            "course_id": s.assignment.course_id,
            "course_title": s.assignment.course.title,
            "max_score": s.assignment.max_score,
            "score": s.score,
            "feedback": s.feedback,
            "submitted_at": iso(s.submitted_at),
            "late": bool(s.assignment.due_date and s.submitted_at > s.assignment.due_date),
        }
        for s in subs
    ]

    quizzes = {}
    attempts = db.scalars(
        select(QuizAttempt).where(QuizAttempt.student_id == user.id).order_by(QuizAttempt.taken_at)
    ).all()
    for qa in attempts:
        row = quizzes.setdefault(
            qa.quiz_id,
            {
                "quiz_id": qa.quiz_id,
                "title": qa.quiz.title,
                "course_id": qa.quiz.course_id,
                "course_title": qa.quiz.course.title,
                "best": 0,
                "total": qa.total,
                "count": 0,
                "last_taken": None,
            },
        )
        row["count"] += 1
        row["last_taken"] = iso(qa.taken_at)
        if qa.score >= row["best"]:
            row["best"], row["total"] = qa.score, qa.total
    return {"assignments": assignments, "quizzes": list(quizzes.values())}


# ======================================================================
# Quizzes
# ======================================================================
@router.post("/courses/{course_id}/quizzes", status_code=201)
def create_quiz(
    course_id: int, data: QuizIn, user: User = Depends(require_roles(*STAFF)), db: Session = Depends(get_db)
):
    c = get_or_404(db, Course, course_id, "Course")
    require_manage(user, c)
    quiz = Quiz(course_id=c.id, title=data.title)
    quiz.questions = [
        Question(text=q.text, options=list(q.options), correct_index=q.correct_index) for q in data.questions
    ]
    db.add(quiz)
    db.commit()
    return quiz_out(quiz, reveal=True)


@router.delete("/quizzes/{quiz_id}", status_code=204)
def delete_quiz(quiz_id: int, user: User = Depends(require_roles(*STAFF)), db: Session = Depends(get_db)):
    quiz = get_or_404(db, Quiz, quiz_id, "Quiz")
    require_manage(user, quiz.course)
    db.delete(quiz)
    db.commit()


@router.get("/quizzes/{quiz_id}")
def get_quiz(quiz_id: int, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    quiz = get_or_404(db, Quiz, quiz_id, "Quiz")
    require_access(db, user, quiz.course)
    out = quiz_out(quiz, reveal=can_manage(user, quiz.course))
    out["course"] = {"id": quiz.course.id, "title": quiz.course.title}
    return out


@router.post("/quizzes/{quiz_id}/attempt")
def attempt_quiz(
    quiz_id: int,
    data: AttemptIn,
    user: User = Depends(require_roles("student")),
    db: Session = Depends(get_db),
):
    quiz = get_or_404(db, Quiz, quiz_id, "Quiz")
    require_access(db, user, quiz.course)
    questions = quiz.questions
    if len(data.answers) != len(questions):
        raise HTTPException(400, "Provide one answer for every question (use -1 to skip)")

    results, score = [], 0
    for question, chosen in zip(questions, data.answers):
        correct = chosen == question.correct_index
        score += 1 if correct else 0
        results.append(
            {
                "question_id": question.id,
                "chosen": chosen,
                "correct": correct,
                "correct_index": question.correct_index,
            }
        )
    db.add(QuizAttempt(quiz_id=quiz.id, student_id=user.id, score=score, total=len(questions)))
    db.commit()
    total = len(questions)
    return {
        "score": score,
        "total": total,
        "percent": round(score / total * 100) if total else 0,
        "results": results,
    }


@router.get("/quizzes/{quiz_id}/attempts")
def quiz_attempts(quiz_id: int, user: User = Depends(require_roles(*STAFF)), db: Session = Depends(get_db)):
    quiz = get_or_404(db, Quiz, quiz_id, "Quiz")
    require_manage(user, quiz.course)
    rows = db.scalars(
        select(QuizAttempt).where(QuizAttempt.quiz_id == quiz.id).order_by(QuizAttempt.taken_at.desc())
    ).all()
    return {
        "quiz": {"id": quiz.id, "title": quiz.title, "course_id": quiz.course_id},
        "attempts": [
            {
                "id": r.id,
                "student": {"id": r.student.id, "name": r.student.name},
                "score": r.score,
                "total": r.total,
                "taken_at": iso(r.taken_at),
            }
            for r in rows
        ],
    }


# ======================================================================
# Teacher dashboard
# ======================================================================
@router.get("/teacher/summary")
def teacher_summary(user: User = Depends(require_roles(*STAFF)), db: Session = Depends(get_db)):
    courses = db.scalars(
        select(Course).where(Course.teacher_id == user.id).order_by(Course.created_at.desc(), Course.id.desc())
    ).all()
    ids = [c.id for c in courses]
    students = ungraded_total = 0
    ungraded = []
    if ids:
        students = (
            db.scalar(
                select(func.count(func.distinct(Enrollment.student_id))).where(Enrollment.course_id.in_(ids))
            )
            or 0
        )
        base = (
            select(Submission)
            .join(Assignment, Assignment.id == Submission.assignment_id)
            .where(Assignment.course_id.in_(ids), Submission.score.is_(None))
        )
        ungraded_total = db.scalar(select(func.count()).select_from(base.subquery())) or 0
        for s in db.scalars(base.order_by(Submission.submitted_at.asc()).limit(8)):
            ungraded.append(
                {
                    "submission_id": s.id,
                    "assignment_id": s.assignment_id,
                    "assignment_title": s.assignment.title,
                    "course_title": s.assignment.course.title,
                    "student": s.student.name,
                    "submitted_at": iso(s.submitted_at),
                }
            )
    return {
        "stats": {
            "courses": len(courses),
            "published": sum(1 for c in courses if c.status == "published"),
            "students": students,
            "ungraded": ungraded_total,
        },
        "ungraded": ungraded,
        "courses": [course_out(c) for c in courses[:6]],
    }
