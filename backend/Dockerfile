# API FastAPI (Python 3.12 + uv). Contesto di build: backend.
FROM python:3.15-slim AS builder
COPY --from=ghcr.io/astral-sh/uv:0.5 /uv /usr/local/bin/uv
WORKDIR /app
ENV UV_COMPILE_BYTECODE=1 UV_LINK_MODE=copy
COPY pyproject.toml uv.lock .python-version ./
RUN uv sync --frozen --no-dev --no-install-project --no-cache
COPY src ./src
RUN uv sync --frozen --no-dev --no-cache

FROM python:3.15-slim
WORKDIR /app
ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    MALLOC_ARENA_MAX=2 \
    PATH="/app/.venv/bin:$PATH"
COPY --from=builder /app/.venv /app/.venv
COPY --from=builder /app/src /app/src
COPY docker-entrypoint.sh ./docker-entrypoint.sh
# COPY conserva i permessi dell'host (es. file 600 su macOS): l'utente non privilegiato deve poter leggere il codice
RUN chmod -R a+rX /app/src /app/docker-entrypoint.sh \
    && chmod a+rx /app/docker-entrypoint.sh \
    && useradd --system --uid 10001 --shell /usr/sbin/nologin nzt
USER nzt
EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD ["python", "-c", "import os, urllib.request; urllib.request.urlopen('http://127.0.0.1:' + os.environ.get('PORT', '8000') + '/healthz', timeout=3)"]
ENTRYPOINT ["/app/docker-entrypoint.sh"]
# Railway imposta PORT; in locale 8000. --no-proxy-headers obbligatorio (spec §15): ClientIPResolver gestisce XFF.
CMD ["sh", "-c", "exec uvicorn app.main:create_app --factory --host 0.0.0.0 --port ${PORT:-8000} --no-proxy-headers --no-server-header --loop uvloop --http httptools --limit-concurrency 64 --timeout-keep-alive 65 --timeout-graceful-shutdown 25"]
