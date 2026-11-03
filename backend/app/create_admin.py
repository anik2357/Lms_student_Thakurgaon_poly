"""Create (or reset) an administrator account.

    python -m app.create_admin you@school.edu "Your Name"

The password is prompted for, so it never appears in shell history.
"""
import getpass
import sys

from sqlalchemy import select

from .database import SessionLocal, init_db
from .models import User
from .security import hash_password


def main() -> None:
    if len(sys.argv) < 2:
        sys.exit('Usage: python -m app.create_admin EMAIL ["Full Name"]')
    email = sys.argv[1].strip().lower()
    name = sys.argv[2].strip() if len(sys.argv) > 2 else "Administrator"
    password = getpass.getpass("Password (min 6 characters): ")
    if len(password) < 6:
        sys.exit("Password is too short.")
    if password != getpass.getpass("Repeat password: "):
        sys.exit("Passwords do not match.")

    init_db()
    with SessionLocal() as db:
        user = db.scalar(select(User).where(User.email == email))
        if user:
            user.role, user.is_active = "admin", True
            user.password_hash = hash_password(password)
            print(f"Updated existing account {email}: now an active administrator.")
        else:
            db.add(User(name=name, email=email, password_hash=hash_password(password), role="admin"))
            print(f"Created administrator {email}.")
        db.commit()


if __name__ == "__main__":
    main()
