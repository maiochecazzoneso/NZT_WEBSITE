#!/bin/sh
# Avvio dell'API. Con NZT_BOOTSTRAP=true (SOLO stack di prova, docker-compose.yml) applica prima le
# migrazioni e crea l'account di prova; poi lancia il comando. Le credenziali del ruolo migratore
# sono passate in NZT_BOOTSTRAP_MIGRATIONS_URL, viste solo dai due comandi di bootstrap, e rimosse
# dall'ambiente prima di avviare il server: il processo API non le conserva (spec sicurezza §2).
# In produzione (NZT_ENVIRONMENT=production) il bootstrap è rifiutato: migrazioni = step di pre-deploy.
set -eu

if [ "${NZT_BOOTSTRAP:-false}" = "true" ]; then
  if [ "${NZT_ENVIRONMENT:-development}" = "production" ]; then
    echo "docker-entrypoint: NZT_BOOTSTRAP rifiutato in produzione" >&2
    exit 1
  fi
  NZT_MIGRATIONS_DATABASE_URL="$NZT_BOOTSTRAP_MIGRATIONS_URL" alembic upgrade head
  # Utenti di prova SOLO se richiesto esplicitamente (NZT_SEED_DEV_USERS=true). Password: admin/cliente
  # oppure quelle di NZT_SEED_ADMIN_PASSWORD / NZT_SEED_CLIENT_PASSWORD. Mai su un URL pubblico con i default.
  if [ "${NZT_SEED_DEV_USERS:-false}" = "true" ]; then
    python scripts/seed_dev_users.py
  fi
fi

unset NZT_BOOTSTRAP NZT_BOOTSTRAP_MIGRATIONS_URL NZT_SEED_DEV_USERS NZT_SEED_ADMIN_PASSWORD NZT_SEED_CLIENT_PASSWORD
exec "$@"
