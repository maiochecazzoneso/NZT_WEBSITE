# Database (MongoDB)

L'Area Clienti usa un **MongoDB esterno** (es. Atlas) condiviso con gli altri servizi NZT: un solo
servizio da pagare, **un database per servizio** (`nzt` per questa API) e utenti limitati a quel database.

| Cosa | Dove |
| --- | --- |
| Schema: collection, validatori `$jsonSchema`, indici, TTL | `backend/src/app/schema.py` (lo usa l'API, quindi vive nel suo codice) |
| Applicare / verificare lo schema | `cd backend && uv run python -m app.schema [--check]` |
| Utenti a privilegio minimo (MongoDB autogestito, test, docker compose) | `create_roles.py` |
| Migrazione una tantum dei dati da PostgreSQL | `migrate_postgres_to_mongo.py` (da eliminare dopo il passaggio) |

Gli script girano con l'ambiente Python del backend (importano la lista delle collection da `app.schema`).
Dalla radice del repository:

```bash
NZT_MONGODB_ROOT_URI='mongodb://root:...@host:27017/?authSource=admin' NZT_DB_NAME=nzt \
  NZT_MIGRATOR_PASSWORD='...' NZT_APP_PASSWORD='...' \
  uv run --project backend python database/create_roles.py
```

```bash
NZT_PG_SOURCE_DSN='postgresql://...' NZT_MONGODB_MIGRATIONS_URI='mongodb+srv://nzt_migrator:...' \
  NZT_MONGODB_DATABASE=nzt \
  uv run --project backend --with asyncpg python database/migrate_postgres_to_mongo.py --dry-run
```

| Utente | Permessi |
| --- | --- |
| `nzt_app` (API) | ruolo `nztApp`: solo `find`, `insert`, `update`, `remove` sulle collection dell'API |
| `nzt_migrator` (schema, migrazione) | `dbAdmin` + `readWrite` sul solo database `nzt` |

Su **Atlas** ruoli e utenti si creano da *Database Access* (Custom Roles + Database Users); la rete va
limitata con la *IP Access List* agli IP di uscita dei servizi (mai `0.0.0.0/0`). Dettagli e motivazioni:
`docs/architettura_sicurezza_area_clienti.md` §5, §16 e §24.2.
