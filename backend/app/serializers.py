"""Turn ORM objects into JSON-friendly dicts."""
from .utils import iso


def user_out(u):
    return {
        "id": u.id,
        "name": u.name,
        "email": u.email,
        "role": u.role,
        "is_active": u.is_active,
        "created_at": iso(u.created_at),
    }


def person(u):
    return {"id": u.id, "name": u.name}


def course_out(c, **extra):
    return {
        "id": c.id,
        "title": c.title,
        "description": c.description,
        "category": c.category,
        "status": c.status,
        "teacher": person(c.teacher),
        "lesson_count": len(c.lessons),
        "student_count": len(c.enrollments),
        "created_at": iso(c.created_at),
        **extra,
    }


def lesson_out(l, full=False, done=False):
    data = {"id": l.id, "title": l.title, "order_index": l.order_index}
    if full:
        data.update(
            content=l.content,
            video_url=l.video_url,
            materials=[{"id": m.id, "filename": m.filename} for m in l.materials],
            done=done,
        )
    return data


def submission_out(s, with_student=False):
    due = s.assignment.due_date if s.assignment else None
    data = {
        "id": s.id,
        "assignment_id": s.assignment_id,
        "text": s.text,
        "filename": s.filename,
        "submitted_at": iso(s.submitted_at),
        "score": s.score,
        "feedback": s.feedback,
        "late": bool(due and s.submitted_at > due),
    }
    if with_student:
        data["student"] = {"id": s.student.id, "name": s.student.name, "email": s.student.email}
    return data


def assignment_out(a, submission=None, manager=False):
    data = {
        "id": a.id,
        "course_id": a.course_id,
        "title": a.title,
        "description": a.description,
        "due_date": iso(a.due_date),
        "max_score": a.max_score,
    }
    if manager:
        data["submission_count"] = len(a.submissions)
        data["ungraded_count"] = sum(1 for s in a.submissions if s.score is None)
    else:
        data["submission"] = submission_out(submission) if submission else None
    return data


def quiz_out(q, reveal=False):
    questions = []
    for qu in q.questions:
        item = {"id": qu.id, "text": qu.text, "options": qu.options}
        if reveal:
            item["correct_index"] = qu.correct_index
        questions.append(item)
    return {"id": q.id, "course_id": q.course_id, "title": q.title, "questions": questions}


def quiz_summary(q, attempt=None, manager=False):
    data = {"id": q.id, "title": q.title, "question_count": len(q.questions)}
    if manager:
        data["attempt_count"] = len(q.attempts)
    else:
        data["attempt"] = attempt
    return data


def announcement_out(a):
    return {
        "id": a.id,
        "course_id": a.course_id,
        "message": a.message,
        "created_at": iso(a.created_at),
        "author": person(a.author),
    }
