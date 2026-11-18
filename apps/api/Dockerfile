# API FastAPI (Python 3.12 + uv). Contesto di build: apps/api.
FROM python:3.12-slim
COPY --from=ghcr.io/astral-sh/uv:0.5 /uv /usr/local/bin/uv
WORKDIR /app
ENV UV_COMPILE_BYTECODE=1 UV_LINK_MODE=copy PATH="/app/.venv/bin:$PATH"
COPY pyproject.toml uv.lock .python-version ./
RUN uv sync --frozen --no-dev --no-install-project
COPY src ./src
COPY scripts/seed_dev_users.py ./scripts/seed_dev_users.py
COPY scripts/db/create_roles.py ./scripts/db/create_roles.py
COPY docker-entrypoint.sh ./docker-entrypoint.sh
RUN uv sync --frozen --no-dev
# COPY conserva i permessi dell'host (es. file 600 su macOS): l'utente non privilegiato deve poter leggere il codice
RUN chmod -R a+rX /app/src /app/scripts /app/docker-entrypoint.sh
RUN chmod a+rx /app/docker-entrypoint.sh
RUN useradd --system --uid 10001 nzt
USER nzt
EXPOSE 8000
ENTRYPOINT ["/app/docker-entrypoint.sh"]
# Railway imposta PORT; in locale 8000
CMD ["sh", "-c", "exec uvicorn app.main:create_app --factory --host 0.0.0.0 --port ${PORT:-8000}"]
