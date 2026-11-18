# Ambiente Railway `test` (piano gratuito)

Progetto `hospitable-consideration`, ambiente `test` (separato da `production`, che segue `main`).

| Servizio | Sorgente | Note |
|---|---|---|
| Redis | template Railway | rete privata, volume < 0,5 GB (limite piano gratuito) |
| MongoDB | **esterno** (cluster condiviso, database `nzt`), non su Railway | `NZT_MONGODB_URI` (utente `nzt_app`) e `NZT_MONGODB_DATABASE` sull'api; IP Access List del cluster con gli IP di uscita di Railway |
| api | branch `implementazione-area-clienti`, root `/backend` | FastAPI; schema MongoDB all'avvio (`NZT_BOOTSTRAP=true` + `NZT_BOOTSTRAP_MIGRATIONS_URI` dell'utente `nzt_migrator`); `PORT` da Railway |
| web | stesso branch, `frontend/deploy/web.Dockerfile` | un solo Caddy: portale clienti (host di default) + dashboard admin (`ADMIN_HOST`) |

Risparmio: *App Sleeping* attivo (i servizi dormono dopo ~10 min senza traffico), limiti di memoria (api 0,5 GB, web 0,25 GB), regione `iad` come Redis (scegliere la stessa regione anche per il cluster MongoDB), Argon2 a concorrenza 1 e pool DB piccolo (`NZT_MONGODB_MAX_POOL_SIZE`).

Utenti di prova: NON creati di default su Railway (URL pubblico). Per crearli impostare sull'api `NZT_SEED_DEV_USERS=true`
e password forti in `NZT_SEED_ADMIN_PASSWORD` / `NZT_SEED_CLIENT_PASSWORD`. Mai le password di default (`admin`/`cliente`).
