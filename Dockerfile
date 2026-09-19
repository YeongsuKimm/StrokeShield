# StrokeShield backend (FastAPI). Torch-free on purpose: the optional phoneme model (requirements-ml.txt) stays off here
# and PHONEME_SCORING defaults to false. No secrets are baked in: every key comes from the host's environment variables
# (Railway "Variables"); .env is excluded by .dockerignore.
FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

WORKDIR /app

# Dependencies first so code changes reuse the cached layer.
COPY requirements.txt .
RUN pip install -r requirements.txt

COPY backend ./backend
COPY models ./models
COPY services ./services

RUN useradd --create-home --uid 10001 appuser && chown -R appuser /app
USER appuser

# Railway injects PORT; 8000 locally.
ENV PORT=8000
EXPOSE 8000

# --proxy-headers + forwarded-allow-ips: behind Railway's proxy the per-IP rate limits must see the real client address.
# --no-access-log: request lines (paths, addresses) are not kept; app logs carry only module tags and error types.
CMD ["sh", "-c", "exec uvicorn backend.main:app --host 0.0.0.0 --port ${PORT} --proxy-headers --forwarded-allow-ips='*' --no-access-log"]
