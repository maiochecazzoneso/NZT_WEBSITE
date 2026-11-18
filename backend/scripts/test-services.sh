#!/usr/bin/env bash
# Start/stop throwaway MongoDB 8 + Redis 7 for the test-suite using the NATIVE binaries
# (for sandboxes/CI without a Docker daemon).
# On a normal developer machine prefer:  docker compose -f docker-compose.test.yml up -d
# Both expose the same endpoints:
#   MongoDB 127.0.0.1:57017  single-node replica set "rs0" with authentication (like Atlas);
#           TTL monitor off so that documents expired on purpose stay during a test
#           db=nzt_test  users nzt_migrator / nzt_app (database/create_roles.py)
#   Redis   127.0.0.1:56379
#
# Usage: scripts/test-services.sh start|stop|status
# MONGOD=/path/to/mongod if it is not on PATH. TEST ONLY credentials.
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
API_DIR="$(dirname "$HERE")"
STATE_DIR="${NZT_TEST_STATE_DIR:-/tmp/nzt-api-test-services}"
MONGOD="${MONGOD:-mongod}"
MONGO_PORT="${NZT_TEST_MONGO_PORT:-57017}"
REDIS_PORT="${NZT_TEST_REDIS_PORT:-56379}"
MONGO_DATA="$STATE_DIR/mongodata"
ROOT_URI="mongodb://root:root_test@127.0.0.1:$MONGO_PORT/?authSource=admin&directConnection=true"

py() { (cd "$API_DIR" && uv run --quiet python "$@"); }

start() {
  mkdir -p "$STATE_DIR"
  FRESH=0
  if [ ! -d "$MONGO_DATA" ]; then
    mkdir -p "$MONGO_DATA"
    openssl rand -base64 756 >"$STATE_DIR/keyfile"
    chmod 400 "$STATE_DIR/keyfile"
    FRESH=1
  fi
  if ! py -c "import pymongo,sys; pymongo.MongoClient('mongodb://127.0.0.1:$MONGO_PORT/?directConnection=true', serverSelectionTimeoutMS=500).admin.command('ping')" >/dev/null 2>&1; then
    "$MONGOD" --replSet rs0 --bind_ip 127.0.0.1 --port "$MONGO_PORT" --dbpath "$MONGO_DATA" \
      --auth --keyFile "$STATE_DIR/keyfile" --wiredTigerCacheSizeGB 0.25 \
      --setParameter ttlMonitorEnabled=false \
      --fork --logpath "$STATE_DIR/mongod.log" >/dev/null
  fi
  if [ "$FRESH" -eq 1 ]; then
    # Localhost exception: initiate the replica set and create the (test) root user.
    py - "$MONGO_PORT" <<'EOF'
import sys, time
from pymongo import MongoClient
port = sys.argv[1]
c = MongoClient(f"mongodb://127.0.0.1:{port}/?directConnection=true")
c.admin.command("replSetInitiate", {"_id": "rs0", "members": [{"_id": 0, "host": f"127.0.0.1:{port}"}]})
for _ in range(100):
    if c.admin.command("hello").get("isWritablePrimary"):
        break
    time.sleep(0.1)
c.admin.command("createUser", "root", pwd="root_test", roles=["root"])
EOF
    NZT_MONGODB_ROOT_URI="$ROOT_URI" NZT_DB_NAME=nzt_test \
      NZT_MIGRATOR_PASSWORD=nzt_migrator_test NZT_APP_PASSWORD=nzt_app_test \
      py "$API_DIR/../database/create_roles.py" >/dev/null
  fi
  if ! redis-cli -p "$REDIS_PORT" ping >/dev/null 2>&1; then
    redis-server --port "$REDIS_PORT" --bind 127.0.0.1 --save "" --appendonly no \
      --daemonize yes --pidfile "$STATE_DIR/redis.pid" --logfile "$STATE_DIR/redis.log"
    for _ in $(seq 1 50); do redis-cli -p "$REDIS_PORT" ping >/dev/null 2>&1 && break; sleep 0.1; done
  fi
  status
}

stop() {
  if [ -d "$MONGO_DATA" ]; then
    "$MONGOD" --dbpath "$MONGO_DATA" --shutdown >/dev/null 2>&1 || true
  fi
  redis-cli -p "$REDIS_PORT" shutdown nosave >/dev/null 2>&1 || true
  rm -rf "$STATE_DIR"
  echo "stopped"
}

status() {
  echo "mongodb: $(py -c "import pymongo; print(pymongo.MongoClient('$ROOT_URI', serverSelectionTimeoutMS=1000).admin.command('ping')['ok'])" 2>/dev/null || echo down)"
  echo "redis: $(redis-cli -p "$REDIS_PORT" ping 2>/dev/null || echo down)"
}

case "${1:-}" in
  start) start ;;
  stop) stop ;;
  status) status ;;
  *) echo "usage: $0 start|stop|status" >&2; exit 2 ;;
esac
