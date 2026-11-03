# Lumen: Student LMS

A complete learning management system with three roles (student, teacher, administrator).

- **Backend:** FastAPI, SQLAlchemy 2, JWT auth, bcrypt, **PostgreSQL** (psycopg 3 driver)
- **Frontend:** plain HTML/CSS and JavaScript ES modules. All data goes through the `fetch()` API. No build step.
- **One process:** FastAPI serves both the REST API (`/api/v1`) and the frontend files.

## Run it

**1. A PostgreSQL database** (version 13 or newer). Start the bundled one with `docker compose up db -d`
(add `ports: ["5432:5432"]` to the `db` service in `docker-compose.yml` first so your computer can reach it), or use your own and create a user and database:

```sql
CREATE USER lms WITH PASSWORD 'change-me' CREATEDB;
CREATE DATABASE lms OWNER lms;
```

**2. Tell the app how to connect.** Copy `.env.example` to `backend/.env` and edit it (the app loads that file on start; real environment variables win over it):

```
LMS_DB_HOST=127.0.0.1
LMS_DB_PORT=5432
LMS_DB_USER=lms
LMS_DB_PASSWORD=change-me
LMS_DB_NAME=lms
```

Or give one URL instead: `DATABASE_URL=postgresql://lms:change-me@127.0.0.1:5432/lms` (`LMS_DATABASE_URL` also works and takes priority).
Tables are created automatically on every start. `backend/app/database.py` holds the connection code.

**3. Start the server:**

```bash
cd backend
python -m venv .venv
source .venv/bin/activate          # Windows: .venv\Scripts\activate
pip install -r requirements.txt
uvicorn app.main:app --reload
```

Open <http://localhost:8000>. Interactive API docs: <http://localhost:8000/docs>.

On the first start with an empty database, demo data is created automatically:

| Role | Email | Password |
|---|---|---|
| Administrator | `admin@lms.test` | `admin123` |
| Teacher | `teacher@lms.test` | `teacher123` |
| Student | `alice@lms.test` | `student123` |

(`bob@lms.test`, `daniel@lms.test` and a pending teacher `new.teacher@lms.test` are also created.)
The login page shows one-click demo buttons on `localhost` only.

To reset the demo data: stop the server, run `python -m app.seed --reset` (this **drops all tables** in the configured database), and delete `backend/uploads/`.

## Features

**Students**
- Dashboard with progress, deadlines, announcements and average grade
- Course catalog with search and category filter, enroll and leave
- Lesson player: written content, YouTube/Vimeo video, downloadable files, mark complete, progress bar
- Assignments: text answer and/or file upload, update until graded, late flag, grade and feedback
- Auto-graded multiple-choice quizzes with answer review and unlimited retakes
- Grades page for assignments and quizzes, profile and password change

**Teachers**
- Dashboard with a grading queue
- Course editor: lessons (reorder, edit, attach files), assignments, quizzes, student roster with progress, announcements
- Grading with score and feedback, quiz results per student
- Publishing flow: draft, submit for review, published by an administrator
- New teacher accounts must be approved by an administrator

**Administrators**
- Overview with platform stats, charts and "needs attention" alerts
- Users: search, filter, create, edit, change role, approve or deactivate, reset password, delete
- Courses: review queue, publish, send back, archive, restore, delete
- Audit log of important changes

## Project layout

```
backend/
  app/
    main.py          app, routers, static frontend mount
    config.py        settings from environment variables
    database.py      PostgreSQL engine, session, wait-for-server, auto-create tables
    models.py        SQLAlchemy models
    schemas.py       request validation (Pydantic)
    security.py      password hashing, JWT, role guards, login rate limit
    deps.py          permission helpers (who can see or manage a course)
    serializers.py   ORM to JSON
    files.py         safe upload and download
    seed.py          demo data         create_admin.py  create an admin account
    routers/         auth.py  courses.py  work.py  admin.py
  tests/             pytest API tests
frontend/
  index.html  login.html  register.html
  css/style.css      design system (light and dark theme)
  js/                api.js (fetch wrapper)  auth.js  ui.js  shell.js  profile.js
  student/  teacher/  admin/      index.html + app.js each (hash-routed single page apps)
```

## Security notes

- Permissions are enforced on the server for every endpoint. The role is read from the database on each request, so deactivating a user or changing a role takes effect immediately. Hiding buttons in the UI is only a convenience.
- Students can only read lesson content of courses they are enrolled in, and only for published or archived courses. Teachers only manage their own courses. Submission files are visible only to the student and the course teacher or an administrator.
- Uploads: extension allow-list, size limit (`LMS_MAX_UPLOAD_MB`), random stored file names, path traversal protection.
- All user text is rendered with `textContent` (no `innerHTML`), which prevents XSS.
- The access token is kept in `localStorage` for simplicity. For a hardened deployment, move it to an httpOnly cookie and add CSRF protection.
- Login attempts are rate-limited in memory per IP and email. Use a shared store (for example Redis) if you run several workers.

## Deploy on Render

The project ships with a Render Blueprint (`render.yaml`) that creates the web service (built from the `Dockerfile`) and a PostgreSQL database and wires them together.

1. Put the contents of this project folder at the **root** of a GitHub or GitLab repository (`Dockerfile`, `render.yaml`, `backend/`, `frontend/` at the top level) and push it.
2. In the Render dashboard choose **New > Blueprint**, connect the repository and select it.
3. Render asks for `LMS_ADMIN_EMAIL` and `LMS_ADMIN_PASSWORD`. These create your first administrator on the first start (only when no admin exists yet). Use a strong password.
4. Click **Apply**. The first build takes a few minutes. Then open the service URL and sign in with that admin account.

`LMS_SECRET_KEY` is generated for you, `DATABASE_URL` is filled in from the database, and `LMS_AUTO_SEED=0` means no demo data is created. Set it to `1` once if you want the demo accounts and courses.

**Know the limits of the free plan before relying on it:**

- **Uploaded files are lost.** Free web services have an ephemeral filesystem: lesson files and student submissions disappear on every redeploy, restart or spin-down. Text answers, grades and everything else live in the database and are safe. To keep files, use a paid web plan, uncomment the `disk:` block in `render.yaml` (mounted at `/data`) and redeploy.
- **The service sleeps** after about 15 minutes without traffic, and the next visit waits roughly a minute while it wakes up.
- **Free PostgreSQL expires.** Per Render's changelog, free databases expire 30 days after creation, with a 14-day grace period to upgrade to a paid plan before the data is deleted. Check Render's current free-tier terms before using it for real data.
- **One instance only**, which also suits the in-memory login rate limiter.

**Connecting from your own computer** (to inspect or seed the database): use the database's *External* connection URL from the Render dashboard and add `?sslmode=require` (or set `LMS_DB_SSLMODE=require`). The *Internal* URL used by the web service needs no extra setting.

**Not using a Blueprint?** Create a PostgreSQL database and a Web Service (Language: Docker) by hand. Set `DATABASE_URL` to the database's Internal URL, `LMS_SECRET_KEY` to a long random string, `LMS_AUTO_SEED=0`, and the two `LMS_ADMIN_*` variables. Set the health check path to `/api/v1/health`.

## Production checklist

1. Set `LMS_SECRET_KEY` to a long random value and `LMS_AUTO_SEED=0`.
2. Create your own admin: `python -m app.create_admin you@school.edu "Your Name"`. Delete the demo accounts from the admin panel if they exist.
3. Use a dedicated database user with a strong password, and back the database up regularly (`pg_dump`).
4. Serve behind HTTPS (Nginx, Caddy or your platform). A `Dockerfile` is included.
5. Remove the demo-account buttons block in `frontend/login.html` (marked with a comment).
6. For schema changes after launch, add Alembic migrations. Tables are currently created with `create_all`.

## Tests

```bash
cd backend
pip install -r requirements-dev.txt
pytest
```

The tests use a temporary SQLite file (they set `LMS_DATABASE_URL`), so they run without a PostgreSQL server. They cover registration and login, role protection, teacher approval, the full course, enroll, submit, grade and quiz flow, file permissions, and admin safeguards.

## Ideas for later

Email verification and password reset, discussion forum, certificates, calendar view, WebSocket notifications, CSV grade export, Alembic migrations.
