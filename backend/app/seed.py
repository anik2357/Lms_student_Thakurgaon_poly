"""Demo data.  Run with:  python -m app.seed [--reset]"""
import sys
from datetime import timedelta

from sqlalchemy import func, select

from .audit import log
from .models import (
    Announcement,
    Assignment,
    Course,
    Enrollment,
    Lesson,
    LessonProgress,
    Question,
    Quiz,
    QuizAttempt,
    Submission,
    User,
)
from .security import hash_password
from .utils import utcnow

PYTHON_LESSONS = [
    (
        "Welcome and setup",
        "# Welcome\n\nIn this course you will learn to program in Python from scratch.\n\n"
        "Before you start, make sure you have:\n- Python 3.10 or newer installed\n"
        "- A code editor such as VS Code\n- Curiosity!\n\n"
        "Check your installation by running this in a terminal:\n\n```\npython --version\n```",
    ),
    (
        "Variables and data types",
        "# Variables\n\nA variable is a name that refers to a value.\n\n```\nname = \"Ada\"\nage = 36\n"
        "pi = 3.14159\nis_student = True\n```\n\nPython figures out the type automatically: "
        "str, int, float, bool and more.",
    ),
    (
        "Control flow",
        "# Making decisions and repeating work\n\n```\nfor n in range(1, 6):\n    if n % 2 == 0:\n"
        "        print(n, \"is even\")\n    else:\n        print(n, \"is odd\")\n```\n\n"
        "Use `if`/`elif`/`else` to choose, and `for`/`while` to repeat.",
    ),
    (
        "Functions",
        "# Functions\n\nFunctions package reusable logic.\n\n```\ndef greet(name):\n"
        "    return f\"Hello, {name}!\"\n\nprint(greet(\"world\"))\n```\n\n"
        "Good functions do one thing and have a clear name.",
    ),
]


def run(db) -> None:
    def make_user(name, email, role, password, active=True):
        u = User(name=name, email=email, password_hash=hash_password(password), role=role, is_active=active)
        db.add(u)
        return u

    admin = make_user("Site Admin", "admin@lms.test", "admin", "admin123")
    sarah = make_user("Dr. Sarah Khan", "teacher@lms.test", "teacher", "teacher123")
    daniel = make_user("Prof. Daniel Lee", "daniel@lms.test", "teacher", "teacher123")
    make_user("Nina Pending", "new.teacher@lms.test", "teacher", "teacher123", active=False)
    alice = make_user("Alice Johnson", "alice@lms.test", "student", "student123")
    bob = make_user("Bob Martin", "bob@lms.test", "student", "student123")
    db.flush()

    now = utcnow()

    # ----------------------------------------------------------- courses
    python = Course(
        title="Introduction to Python Programming",
        description="Learn the fundamentals of programming with Python: variables, control flow, "
        "functions and problem solving. No prior experience needed.",
        category="Programming",
        status="published",
        teacher_id=sarah.id,
    )
    web = Course(
        title="Web Development Fundamentals",
        description="Build real web pages with HTML, CSS and JavaScript and understand how the "
        "browser turns code into pixels.",
        category="Web",
        status="published",
        teacher_id=sarah.id,
    )
    stats = Course(
        title="Statistics for Everyone",
        description="An intuitive introduction to data, distributions and the ideas behind "
        "everyday statistics.",
        category="Mathematics",
        status="published",
        teacher_id=daniel.id,
    )
    dsa = Course(
        title="Data Structures and Algorithms",
        description="Arrays, linked lists, trees, graphs and the algorithms that use them.",
        category="Computer Science",
        status="pending",
        teacher_id=daniel.id,
    )
    db.add_all([python, web, stats, dsa])
    db.flush()

    for i, (title, content) in enumerate(PYTHON_LESSONS, start=1):
        db.add(Lesson(course_id=python.id, title=title, content=content, order_index=i))
    web_lessons = [
        ("HTML: the structure of a page", "# HTML\n\nHTML describes the **structure** of a page using elements like headings, paragraphs and links.\n\n```\n<h1>Hello</h1>\n<p>My first page.</p>\n```"),
        ("CSS: layout and style", "# CSS\n\nCSS controls how elements look and where they go.\n\n- Selectors choose elements\n- Properties change how they look\n- Flexbox and Grid handle layout"),
        ("JavaScript and the DOM", "# JavaScript\n\nJavaScript makes pages interactive.\n\n```\ndocument.querySelector('button')\n  .addEventListener('click', () => alert('Hi!'));\n```"),
    ]
    for i, (title, content) in enumerate(web_lessons, start=1):
        db.add(Lesson(course_id=web.id, title=title, content=content, order_index=i))
    db.add(Lesson(course_id=stats.id, title="What is data?", content="Data is information that has been recorded.\n\nWe describe it with averages and spreads.", order_index=1))
    db.add(Lesson(course_id=stats.id, title="Distributions", content="A distribution shows how often each value occurs.", order_index=2))
    db.add(Lesson(course_id=dsa.id, title="Arrays and lists", content="An array stores items in contiguous memory.", order_index=1))
    db.flush()

    # ------------------------------------------------------ assignments
    a1 = Assignment(
        course_id=python.id,
        title="Temperature converter",
        description="Write a program that converts Celsius to Fahrenheit and back.\n\n"
        "Submit your .py file or paste your code in the answer box.",
        due_date=now + timedelta(days=7),
        max_score=100,
    )
    a2 = Assignment(
        course_id=python.id,
        title="Number guessing game",
        description="Build a guessing game that gives higher/lower hints.",
        due_date=now + timedelta(days=14),
        max_score=50,
    )
    a3 = Assignment(
        course_id=web.id,
        title="Personal landing page",
        description="Create a one-page personal site using semantic HTML and your own CSS.",
        due_date=now + timedelta(days=10),
        max_score=100,
    )
    db.add_all([a1, a2, a3])
    db.flush()

    # ---------------------------------------------------------- quizzes
    qz = Quiz(course_id=python.id, title="Python basics quiz")
    qz.questions = [
        Question(text="Which keyword defines a function in Python?", options=["func", "def", "function", "lambda"], correct_index=1),
        Question(text="What is the type of the value 3.14?", options=["int", "str", "float", "bool"], correct_index=2),
        Question(text="Which loop is best for iterating over range(5)?", options=["for", "while True", "do-while", "repeat"], correct_index=0),
    ]
    qweb = Quiz(course_id=web.id, title="HTML and CSS check")
    qweb.questions = [
        Question(text="Which tag creates the largest heading?", options=["<h6>", "<head>", "<h1>", "<title>"], correct_index=2),
        Question(text="Which CSS property changes text colour?", options=["font-style", "color", "background", "text-size"], correct_index=1),
    ]
    db.add_all([qz, qweb])
    db.flush()

    # ----------------------------------------- enrollments and activity
    for student, course in [(alice, python), (alice, web), (bob, python), (bob, stats)]:
        db.add(Enrollment(student_id=student.id, course_id=course.id))
    db.flush()

    first_two = db.scalars(select(Lesson).where(Lesson.course_id == python.id).order_by(Lesson.order_index).limit(2)).all()
    for lesson in first_two:
        db.add(LessonProgress(student_id=alice.id, lesson_id=lesson.id))
    db.add(
        Submission(
            assignment_id=a1.id,
            student_id=alice.id,
            text="def c_to_f(c):\n    return c * 9 / 5 + 32\n\ndef f_to_c(f):\n    return (f - 32) * 5 / 9",
            score=88,
            feedback="Clean and correct. Next time add input validation.",
            submitted_at=now - timedelta(days=1),
        )
    )
    db.add(
        Submission(
            assignment_id=a1.id,
            student_id=bob.id,
            text="print(input('C: ') * 1.8 + 32)  # TODO fix",
            submitted_at=now - timedelta(hours=5),
        )
    )
    db.add(QuizAttempt(quiz_id=qz.id, student_id=alice.id, score=2, total=3, taken_at=now - timedelta(days=1)))

    db.add(Announcement(course_id=python.id, author_id=sarah.id, message="Welcome to the course! Office hours are on Thursdays at 4pm.", created_at=now - timedelta(days=2)))
    db.add(Announcement(course_id=web.id, author_id=sarah.id, message="Reminder: bring your laptop to the first live session.", created_at=now - timedelta(days=1)))

    log(db, admin, "system.seed", "Demo data created")
    db.commit()


if __name__ == "__main__":
    from .database import Base, SessionLocal, engine, init_db

    if "--reset" in sys.argv:
        from . import models  # noqa: F401

        Base.metadata.drop_all(engine)
    init_db()
    with SessionLocal() as session:
        if session.scalar(select(func.count()).select_from(User)):
            print("Database already has users. Use --reset to wipe it and reseed.")
        else:
            run(session)
            print("Demo data created.")
            print("  admin@lms.test / admin123")
            print("  teacher@lms.test / teacher123")
            print("  alice@lms.test / student123")
