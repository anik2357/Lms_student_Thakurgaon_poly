"""Request bodies (Pydantic v2). Responses are built by serializers.py."""
from datetime import datetime
from typing import Literal, Optional

from pydantic import BaseModel, ConfigDict, Field, model_validator

EMAIL_PATTERN = r"^[^@\s]+@[^@\s]+\.[^@\s]+$"
Role = Literal["student", "teacher", "admin"]
CourseStatus = Literal["draft", "pending", "published", "archived"]


class Model(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)


# ---------- auth ----------
class RegisterIn(Model):
    name: str = Field(min_length=2, max_length=120)
    email: str = Field(pattern=EMAIL_PATTERN, max_length=255)
    password: str = Field(min_length=6, max_length=128)
    role: Literal["student", "teacher"] = "student"


class LoginIn(Model):
    email: str = Field(max_length=255)
    password: str = Field(max_length=128)


class ProfileIn(Model):
    name: str = Field(min_length=2, max_length=120)


class PasswordChangeIn(Model):
    current_password: str = Field(max_length=128)
    new_password: str = Field(min_length=6, max_length=128)


# ---------- courses ----------
class CourseIn(Model):
    title: str = Field(min_length=3, max_length=200)
    description: str = Field(default="", max_length=5000)
    category: str = Field(default="General", min_length=1, max_length=60)


class LessonIn(Model):
    title: str = Field(min_length=1, max_length=200)
    content: str = Field(default="", max_length=50000)
    video_url: str = Field(default="", max_length=500)


class ReorderIn(Model):
    ids: list[int]


class AnnouncementIn(Model):
    message: str = Field(min_length=1, max_length=3000)


# ---------- assignments ----------
class AssignmentIn(Model):
    title: str = Field(min_length=1, max_length=200)
    description: str = Field(default="", max_length=10000)
    due_date: Optional[datetime] = None
    max_score: int = Field(default=100, ge=1, le=1000)


class GradeIn(Model):
    score: float = Field(ge=0)
    feedback: str = Field(default="", max_length=3000)


# ---------- quizzes ----------
class QuestionIn(Model):
    text: str = Field(min_length=1, max_length=1000)
    options: list[str] = Field(min_length=2, max_length=8)
    correct_index: int = Field(ge=0)

    @model_validator(mode="after")
    def check_options(self):
        if any(not o.strip() for o in self.options):
            raise ValueError("Answer options cannot be empty")
        if self.correct_index >= len(self.options):
            raise ValueError("correct_index must point to one of the options")
        return self


class QuizIn(Model):
    title: str = Field(min_length=1, max_length=200)
    questions: list[QuestionIn] = Field(min_length=1, max_length=100)


class AttemptIn(Model):
    answers: list[int]


# ---------- admin ----------
class AdminUserCreate(Model):
    name: str = Field(min_length=2, max_length=120)
    email: str = Field(pattern=EMAIL_PATTERN, max_length=255)
    password: str = Field(min_length=6, max_length=128)
    role: Role = "student"


class AdminUserUpdate(Model):
    name: Optional[str] = Field(default=None, min_length=2, max_length=120)
    role: Optional[Role] = None
    is_active: Optional[bool] = None
    password: Optional[str] = Field(default=None, min_length=6, max_length=128)


class CourseStatusIn(Model):
    status: CourseStatus
