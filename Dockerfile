FROM python:3.12-slim

ENV PYTHONUNBUFFERED=1 PYTHONDONTWRITEBYTECODE=1

WORKDIR /srv
COPY backend/requirements.txt backend/requirements.txt
RUN pip install --no-cache-dir -r backend/requirements.txt

COPY backend backend
COPY frontend frontend

WORKDIR /srv/backend
RUN mkdir -p /data/uploads
ENV LMS_AUTO_SEED=0 \
    LMS_UPLOAD_DIR=/data/uploads

# Render sets $PORT (10000 by default); locally the app listens on 8000.
# --proxy-headers makes the login rate limiter see the real client IP behind Render's proxy.
EXPOSE 8000
CMD ["sh", "-c", "exec uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000} --proxy-headers --forwarded-allow-ips='*'"]

# Required settings: DATABASE_URL (or LMS_DB_HOST/USER/PASSWORD/NAME) and LMS_SECRET_KEY.
# Create the first administrator by setting LMS_ADMIN_EMAIL and LMS_ADMIN_PASSWORD, or run:
#   python -m app.create_admin you@school.edu "Your Name"
