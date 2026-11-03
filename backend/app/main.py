from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from sqlalchemy import func, select

from . import config
from .database import SessionLocal, init_db
from .models import User
from .security import hash_password
from .routers import admin, auth, courses, work

API_PREFIX = "/api/v1"


def ensure_admin() -> None:
    """Create the first administrator from LMS_ADMIN_EMAIL / LMS_ADMIN_PASSWORD (only if no admin exists)."""
    if not (config.ADMIN_EMAIL and config.ADMIN_PASSWORD):
        return
    if len(config.ADMIN_PASSWORD) < 6:
        print("[LMS] LMS_ADMIN_PASSWORD is shorter than 6 characters; no admin was created.")
        return
    with SessionLocal() as db:
        if db.scalar(select(func.count()).select_from(User).where(User.role == "admin")):
            return
        taken = db.scalar(select(User).where(User.email == config.ADMIN_EMAIL))
        if taken:  # the email is already registered: promote that account
            taken.role, taken.is_active = "admin", True
            taken.password_hash = hash_password(config.ADMIN_PASSWORD)
        else:
            db.add(
                User(
                    name=config.ADMIN_NAME,
                    email=config.ADMIN_EMAIL,
                    password_hash=hash_password(config.ADMIN_PASSWORD),
                    role="admin",
                )
            )
        db.commit()
        print(f"[LMS] Administrator account ready: {config.ADMIN_EMAIL}")


@asynccontextmanager
async def lifespan(app: FastAPI):
    config.UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
    init_db()
    ensure_admin()
    if config.AUTO_SEED:
        with SessionLocal() as db:
            if not db.scalar(select(func.count()).select_from(User)):
                from . import seed

                seed.run(db)
                print(
                    "\n[LMS] Empty database detected: demo data created.\n"
                    "      admin@lms.test / admin123   teacher@lms.test / teacher123   "
                    "alice@lms.test / student123\n"
                    "      Set LMS_AUTO_SEED=0 and change these passwords before deploying.\n"
                )
    yield


app = FastAPI(
    title="Student LMS",
    version="1.0.0",
    description="Learning management system with student, teacher and admin roles.",
    lifespan=lifespan,
)

if config.CORS_ORIGINS:
    app.add_middleware(
        CORSMiddleware,
        allow_origins=config.CORS_ORIGINS,
        allow_methods=["*"],
        allow_headers=["*"],
    )


@app.middleware("http")
async def security_headers(request, call_next):
    response = await call_next(request)
    response.headers.setdefault("X-Content-Type-Options", "nosniff")
    response.headers.setdefault("X-Frame-Options", "DENY")
    response.headers.setdefault("Referrer-Policy", "same-origin")
    return response


for module in (auth, courses, work, admin):
    app.include_router(module.router, prefix=API_PREFIX)


@app.get(f"{API_PREFIX}/health", tags=["meta"])
def health():
    return {"status": "ok"}


# The frontend is plain static files, served by the same process.
# This mount must come last so it does not shadow the API routes.
if config.FRONTEND_DIR.is_dir():
    app.mount("/", StaticFiles(directory=config.FRONTEND_DIR, html=True), name="frontend")
