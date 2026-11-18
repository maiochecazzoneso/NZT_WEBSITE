# Ambiente Railway `test` (piano gratuito)

Progetto `hospitable-consideration`, ambiente `test` (separato da `production`, che segue `main`).

| Servizio | Sorgente | Note |
|---|---|---|
| Postgres, Redis | template Railway | volumi < 0,5 GB (limite piano gratuito) |
| api | branch `implementazione-area-clienti`, root `/apps/api` | FastAPI; migrazioni all'avvio (`NZT_BOOTSTRAP=true`); `PORT` da Railway |
| web | stesso branch, `deploy/web.Dockerfile` | un solo Caddy: portale clienti (host di default) + dashboard admin (`ADMIN_HOST`) |

Risparmio: *App Sleeping* attivo (i servizi dormono dopo ~10 min senza traffico), limiti di memoria (api 0,5 GB, web 0,25 GB), regione `iad` come i database, Argon2 a concorrenza 1 e pool DB piccolo.

Utenti di prova: NON creati di default su Railway (URL pubblico). Per crearli impostare sull'api `NZT_SEED_DEV_USERS=true`
e password forti in `NZT_SEED_ADMIN_PASSWORD` / `NZT_SEED_CLIENT_PASSWORD`. Mai le password di default (`admin`/`cliente`).
