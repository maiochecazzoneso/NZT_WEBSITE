#!/usr/bin/env bash
# Start/stop throwaway PostgreSQL 16 + Redis 7 for the test-suite using the NATIVE
# binaries (for sandboxes/CI without a Docker daemon).
# On a normal developer machine prefer:  docker compose -f docker-compose.test.yml up -d
# Both expose the same endpoints:
#   PostgreSQL 127.0.0.1:55432  db=nzt_test  roles nzt_migrator / nzt_app
#   Redis      127.0.0.1:56379
#
# Usage: scripts/test-services.sh start|stop|status
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
STATE_DIR="${NZT_TEST_STATE_DIR:-/tmp/nzt-api-test-services}"
PG_BIN="${PG_BIN:-/usr/lib/postgresql/16/bin}"
PG_PORT="${NZT_TEST_PG_PORT:-55432}"
REDIS_PORT="${NZT_TEST_REDIS_PORT:-56379}"
PG_DATA="$STATE_DIR/pgdata"
PG_USER="${PG_OS_USER:-postgres}"

as_pg() {
  if [ "$(id -u)" -eq 0 ]; then
    runuser -u "$PG_USER" -- "$@"
  else
    "$@"
  fi
}

start() {
  mkdir -p "$STATE_DIR"
  chmod 777 "$STATE_DIR"
  if [ ! -d "$PG_DATA" ]; then
    mkdir -p "$PG_DATA"
    [ "$(id -u)" -eq 0 ] && chown "$PG_USER" "$PG_DATA"
    echo postgres_test >"$STATE_DIR/pwfile"
    [ "$(id -u)" -eq 0 ] && chown "$PG_USER" "$STATE_DIR/pwfile"
    as_pg "$PG_BIN/initdb" -D "$PG_DATA" -U postgres --auth-local=trust \
      --auth-host=scram-sha-256 --pwfile="$STATE_DIR/pwfile" -E UTF8 >/dev/null
    rm -f "$STATE_DIR/pwfile"
    FRESH=1
  else
    FRESH=0
  fi
  if ! as_pg "$PG_BIN/pg_ctl" -D "$PG_DATA" status >/dev/null 2>&1; then
    as_pg "$PG_BIN/pg_ctl" -D "$PG_DATA" -w -l "$STATE_DIR/postgres.log" \
      -o "-c listen_addresses=127.0.0.1 -p $PG_PORT -k $STATE_DIR -c fsync=off" start >/dev/null
  fi
  if [ "$FRESH" -eq 1 ]; then
    # Copy the scripts where the postgres OS user can read them.
    cp "$HERE/db/roles.sql" "$HERE/db/init-roles.sh" "$STATE_DIR/"
    chmod 644 "$STATE_DIR/roles.sql" "$STATE_DIR/init-roles.sh"
    (cd "$STATE_DIR" && as_pg env PGHOST="$STATE_DIR" PGPORT="$PG_PORT" \
      ROLES_SQL_FILE="$STATE_DIR/roles.sql" bash "$STATE_DIR/init-roles.sh" >/dev/null)
  fi
  if ! redis-cli -p "$REDIS_PORT" ping >/dev/null 2>&1; then
    redis-server --port "$REDIS_PORT" --bind 127.0.0.1 --save "" --appendonly no \
      --daemonize yes --pidfile "$STATE_DIR/redis.pid" --logfile "$STATE_DIR/redis.log"
    for _ in $(seq 1 50); do redis-cli -p "$REDIS_PORT" ping >/dev/null 2>&1 && break; sleep 0.1; done
  fi
  status
}

stop() {
  if [ -d "$PG_DATA" ]; then
    as_pg "$PG_BIN/pg_ctl" -D "$PG_DATA" -m fast stop >/dev/null 2>&1 || true
  fi
  redis-cli -p "$REDIS_PORT" shutdown nosave >/dev/null 2>&1 || true
  rm -rf "$STATE_DIR"
  echo "stopped"
}

status() {
  as_pg "$PG_BIN/pg_isready" -h 127.0.0.1 -p "$PG_PORT" || true
  echo "redis: $(redis-cli -p "$REDIS_PORT" ping 2>/dev/null || echo down)"
}

case "${1:-}" in
  start) start ;;
  stop) stop ;;
  status) status ;;
  *) echo "usage: $0 start|stop|status" >&2; exit 2 ;;
esac
