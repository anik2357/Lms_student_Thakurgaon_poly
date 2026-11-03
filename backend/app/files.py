"""Safe upload / download helpers."""
import re
import uuid
from pathlib import Path

from fastapi import HTTPException, UploadFile

from . import config

ALLOWED_EXTENSIONS = {
    ".pdf", ".doc", ".docx", ".ppt", ".pptx", ".xls", ".xlsx", ".txt", ".md",
    ".csv", ".png", ".jpg", ".jpeg", ".gif", ".zip", ".py", ".ipynb", ".js",
    ".html", ".css", ".json",
}
CHUNK = 1024 * 1024


def safe_name(name) -> str:
    name = Path(name or "file").name
    name = re.sub(r"[^\w.\- ]", "_", name).strip() or "file"
    return name[:150]


async def save_upload(upload: UploadFile, subdir: str):
    """Store an upload and return (original_filename, stored_relative_path)."""
    original = safe_name(upload.filename)
    ext = Path(original).suffix.lower()
    if ext not in ALLOWED_EXTENSIONS:
        raise HTTPException(400, f"Files of type '{ext or 'unknown'}' are not allowed")

    folder = config.UPLOAD_DIR / subdir
    folder.mkdir(parents=True, exist_ok=True)
    stored = f"{uuid.uuid4().hex}{ext}"
    path = folder / stored
    limit = config.MAX_UPLOAD_MB * 1024 * 1024
    size = 0
    try:
        with open(path, "wb") as out:
            while True:
                chunk = await upload.read(CHUNK)
                if not chunk:
                    break
                size += len(chunk)
                if size > limit:
                    raise HTTPException(413, f"File is larger than {config.MAX_UPLOAD_MB} MB")
                out.write(chunk)
    except HTTPException:
        path.unlink(missing_ok=True)
        raise
    return original, f"{subdir}/{stored}"


def path_for(stored_name: str) -> Path:
    root = config.UPLOAD_DIR.resolve()
    path = (config.UPLOAD_DIR / stored_name).resolve()
    if root not in path.parents or not path.is_file():
        raise HTTPException(404, "File not found")
    return path


def remove_stored(*names) -> None:
    root = config.UPLOAD_DIR.resolve()
    for name in names:
        if not name:
            continue
        try:
            path = (config.UPLOAD_DIR / name).resolve()
            if root in path.parents:
                path.unlink(missing_ok=True)
        except OSError:
            pass


# Collectors: gather stored file names before the DB rows are deleted.
def lesson_files(lesson):
    return [m.stored_name for m in lesson.materials]


def assignment_files(assignment):
    return [s.stored_name for s in assignment.submissions if s.stored_name]


def course_files(course):
    names = []
    for lesson in course.lessons:
        names += lesson_files(lesson)
    for assignment in course.assignments:
        names += assignment_files(assignment)
    return names


def user_files(user):
    names = [s.stored_name for s in user.submissions if s.stored_name]
    for course in user.courses:
        names += course_files(course)
    return names
