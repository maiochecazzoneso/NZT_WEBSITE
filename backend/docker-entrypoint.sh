#!/bin/sh
# Avvio dell'API. Con NZT_BOOTSTRAP=true (SOLO stack di prova, docker-compose.yml) applica prima lo
# schema MongoDB (validatori + indici) e crea l'account di prova; poi lancia il comando. Le
# credenziali dell'utente di schema sono passate in NZT_BOOTSTRAP_MIGRATIONS_URI, viste solo dal
# comando di bootstrap, e rimosse dall'ambiente prima di avviare il server: il processo API non le
# conserva (spec sicurezza §2). In produzione (NZT_ENVIRONMENT=production) il bootstrap è rifiutato:
# lo schema si applica in uno step separato (python -m app.schema).
set -eu

if [ "${NZT_BOOTSTRAP:-false}" = "true" ]; then
  if [ "${NZT_ENVIRONMENT:-development}" = "production" ]; then
    echo "docker-entrypoint: NZT_BOOTSTRAP rifiutato in produzione" >&2
    exit 1
  fi
  : "${NZT_BOOTSTRAP_MIGRATIONS_URI:?NZT_BOOTSTRAP=true richiede NZT_BOOTSTRAP_MIGRATIONS_URI (utente MongoDB di schema)}"
  NZT_MONGODB_MIGRATIONS_URI="$NZT_BOOTSTRAP_MIGRATIONS_URI" python -m app.schema
  # Utenti di prova SOLO se richiesto esplicitamente (NZT_SEED_DEV_USERS=true). Password: admin/cliente
  # oppure quelle di NZT_SEED_ADMIN_PASSWORD / NZT_SEED_CLIENT_PASSWORD. Mai su un URL pubblico con i default.
  if [ "${NZT_SEED_DEV_USERS:-false}" = "true" ]; then
    python scripts/seed_dev_users.py
  fi
fi

unset NZT_BOOTSTRAP NZT_BOOTSTRAP_MIGRATIONS_URI NZT_SEED_DEV_USERS NZT_SEED_ADMIN_PASSWORD NZT_SEED_CLIENT_PASSWORD
exec "$@"
