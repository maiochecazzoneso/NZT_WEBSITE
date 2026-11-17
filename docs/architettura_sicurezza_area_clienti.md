# NZT Solutions — Area Clienti: Architettura di Sicurezza (v1.0)

> **Ambito:** Area Clienti `clienti.nztsolutions.it` (portale) + API `api.nztsolutions.it` + distribuzione del Launcher
> **Stato:** descrive il sistema **come implementato** sul branch `implementazione-area-clienti` (commit `2ab0e83` backend, `72e70ea` portale e `packages/ui`)
> **Documento di riferimento originale:** [`specifiche_architetturali_area_clienti_nzt_solutions.md`](./specifiche_architetturali_area_clienti_nzt_solutions.md) (di seguito "la specifica")
> **Autorità:** in caso di disaccordo tra questo documento e il codice, vale il codice; i riferimenti a file (`apps/api/src/app/...`) permettono la verifica puntuale.

---

## 1. Scopo, perimetro e convenzioni

Questo documento è la descrizione unica e autorevole dell'architettura di sicurezza dell'Area Clienti. Ogni requisito della specifica (topologia, modello dati, Argon2id, timing, OAuth + PKCE + state, pre-hijacking, DPoP, access/refresh token, RTR + reuse detection, Web Locks, distribuzione del launcher, contratti API, header, rate limit, piano a fasi) è riformulato **come implementato**, con il file che lo implementa e il test che lo verifica.

**Nel perimetro:** `apps/api` (FastAPI), `apps/portal` (SPA React), `packages/ui` (solo componenti di presentazione, nessuna logica di sicurezza), database, Redis, object storage, integrazione Google.
**Fuori perimetro:** la landing `apps/landing` (sito statico pubblico, nessun dato utente; rilevante solo come sottodominio dello stesso sito registrabile, vedi §8.3), il Launcher desktop (non presente nel repository), l'infrastruttura Railway (non configurata nel repository, vedi §24).

Marcatori usati nelle tabelle:

| Marcatore | Significato |
| :--- | :--- |
| **CONFORME** | Implementato come richiesto dalla specifica |
| **DEVIAZIONE** | Implementato diversamente dalla specifica, con motivazione (§21) |
| **AGGIUNTA** | Non richiesto dalla specifica, aggiunto per sicurezza o coerenza |
| **NON VERIFICATO** | Affermazione non verificata in ambiente reale (es. Railway, Google, R2 reali) |

---

## 2. Stack e struttura del monorepo

| Livello | Tecnologia (versioni risolte nei lockfile) | Ruolo di sicurezza |
| :--- | :--- | :--- |
| **API** | Python 3.12 (`.python-version`), FastAPI 0.163 / Starlette 1.10, uvicorn 0.54 | Autenticazione, sessioni, autorizzazione, download |
| **ORM / driver** | SQLAlchemy 2.1 async + asyncpg 0.32, Alembic 1.20 | Query parametrizzate (prepared statements), migrazioni |
| **Crittografia** | argon2-cffi 25.1, PyJWT 2.15 [crypto], cryptography 50.0 | Argon2id, JWT EdDSA, verifica DPoP ES256, AES-256-GCM |
| **Cache / limiti** | Redis 7 (client redis-py 8.1 asyncio) | Rate limit, anti-replay DPoP, marker di revoca |
| **Database** | PostgreSQL 16 | Utenti, identità, famiglie/refresh token, entitlement, audit |
| **Egress** | httpx 0.28 (solo verso Google), boto3 1.44 (solo firma locale SigV4) | OIDC Google, URL prefirmati |
| **Portale** | React 19 + Vite 6.4 (SPA), TypeScript strict, Tailwind 4; nessun router o form library di terze parti | Token in memoria, chiave DPoP WebCrypto, Web Locks |
| **Design system** | `packages/ui` (`@nzt/ui`): Button, Card, Badge, Input, Field, Alert, `tokens.css` | Nessuna logica di sicurezza |
| **Package manager** | pnpm 10.28 (workspaces `apps/*`, `packages/*`), uv (Python) | Lockfile `pnpm-lock.yaml`, `apps/api/uv.lock` |

```text
apps/
├── landing/   Sito pubblico Astro (nztsolutions.it) — invariato funzionalmente
├── portal/    SPA Area Clienti (clienti.nztsolutions.it)
│   ├── src/auth/        dpop.ts, keyStore.ts, keyManager.ts, tokenStore.ts, session.ts
│   ├── src/api/         http.ts (client API + DPoP), errors.ts (messaggi italiani)
│   ├── src/lib/         locks.ts, oauthCallback.ts, safeUrls.ts, passwordPolicy.ts, router.tsx
│   ├── csp.config.ts    fonte unica di CSP e header del portale
│   └── deploy/          _headers, Caddyfile, _redirects (riferimento di deploy)
└── api/       Backend FastAPI (api.nztsolutions.it)
    ├── src/app/security/  dpop.py, tokens.py, passwords.py, sealed.py, jose_utils.py
    ├── src/app/services/  sessions.py (RTR), google.py (OIDC), storage.py (presign)
    ├── src/app/routers/   auth.py, google.py, downloads.py, health.py
    ├── src/app/           config.py, cookies.py, client_ip.py, ratelimit.py, middleware.py, errors.py, deps.py, main.py
    ├── alembic/           migrazione 0001_initial_schema.py
    └── scripts/db/        roles.sql, init-roles.sh
packages/
└── ui/        @nzt/ui (consumato da sorgente da landing e portal)
```

---

## 3. Topologia, origini e confini di fiducia

### 3.1 Mappa domini e origini

| Origine | Contenuto | Note di sicurezza |
| :--- | :--- | :--- |
| `https://nztsolutions.it` | Landing statica | Nessun cookie dell'Area Clienti; condivide il sito registrabile con portale e API |
| `https://clienti.nztsolutions.it` | Portale (SPA statica) | Unico origin ammesso da CORS (`NZT_PORTAL_ORIGINS`); `connect-src` limitato all'API |
| `https://api.nztsolutions.it` | API FastAPI | Emette cookie host-only con `Path=/api/v1/auth`; `iss` dei JWT e base `htu` DPoP |
| `https://<account>.r2.cloudflarestorage.com` | Endpoint S3 di R2 (bucket privato) | Raggiunto **solo dal browser** tramite URL prefirmato (navigazione), mai dall'API |
| `https://accounts.google.com`, `oauth2.googleapis.com`, `www.googleapis.com` | Google OIDC | Autorizzazione (navigazione browser), token endpoint e JWKS (egress API) |

Portale e API sono **origin diversi ma stesso sito** (`nztsolutions.it`): questo è un requisito funzionale, perché il cookie di refresh `SameSite=Strict` viene inviato dalle `fetch` del portale verso l'API solo se le due origini sono same-site. Tutti gli URL pubblici sono variabili d'ambiente con default `.it` (`apps/api/src/app/config.py`).

> **Attenzione (deploy):** i domini generati di Railway (`*.up.railway.app`) sono, per quanto noto, nella Public Suffix List: portale e API su due sottodomini generati sarebbero **cross-site** e il cookie `SameSite=Strict` non verrebbe inviato. In produzione vanno usati i domini personalizzati. **NON VERIFICATO** su Railway.

### 3.2 Dove gira cosa (target Railway)

Il target di hosting è Railway. **Nessuna configurazione Railway, Dockerfile o pipeline CI è presente nel repository** (punto aperto O-1, §23): la tabella descrive il dispiegamento previsto.

| Servizio | Artefatto | Esposizione | Stato nel repository |
| :--- | :--- | :--- | :--- |
| Landing | `apps/landing/dist` (statico) | Pubblico, `nztsolutions.it` | Build verificata; nessuna config Railway |
| Portale | `apps/portal/dist` (statico) | Pubblico, `clienti.nztsolutions.it` | Header pronti in `deploy/Caddyfile` (riusabile in un container Caddy) e `deploy/_headers` (Cloudflare Pages/Netlify); nessuna config Railway |
| API | container Python, `uvicorn app.main:create_app --factory --no-proxy-headers` | Pubblico tramite edge Railway, `api.nztsolutions.it` | Codice pronto; Dockerfile assente |
| PostgreSQL 16 | servizio gestito | **Solo rete privata** (`postgres.railway.internal`, vedi `.env.example`) | `scripts/db/roles.sql` da eseguire una volta |
| Redis 7 | servizio gestito | **Solo rete privata** (`redis.railway.internal`) | — |
| Object storage | Cloudflare R2 (o S3), bucket privato `nzt-binaries` | Accesso solo con URL prefirmati | Credenziali di sola lettura da creare |

### 3.3 Diagramma e confini di fiducia

```
                               INTERNET (non fidato)
 ┌──────────────────────────────────────────────────────────────────────────────┐
 │ Browser dell'utente                                                          │
 │  origin https://clienti.nztsolutions.it (SPA)                                │
 │   ├─ access token: solo memoria JS (closure)                                 │
 │   ├─ chiave DPoP ECDSA P-256 extractable=false: IndexedDB "nzt-portal"       │
 │   └─ cookie __Secure-refresh-token: host-only api.nztsolutions.it,           │
 │      HttpOnly, Secure, SameSite=Strict, Path=/api/v1/auth (invisibile a JS)  │
 └──────┬──────────────────────┬─────────────────────────┬──────────────────────┘
        │ GET statici           │ fetch CORS               │ navigazioni top-level
        │                       │ DPoP + Authorization     │ (authorize Google,
        ▼                       │ + cookie /api/v1/auth    │  URL prefirmato R2)
 ══[B1]═ Edge Railway (TLS) ════╪═════════════════════════╪═══════════════════════
   landing / portal statici     ▼                          ▼
                     ┌──────────────────────────┐   Google Accounts / R2
                     │ [B2] API FastAPI          │
                     │  SecurityHeaders ▸ Body   │
                     │  limit ▸ CORS ▸ router    │
                     │  DPoP ▸ rate limit ▸ auth │
                     └──┬───────────┬────────┬──┘
          rete privata  │           │        │ egress HTTPS [B4]
          Railway [B3]  ▼           ▼        ▼ (solo URL Google configurati,
                  PostgreSQL 16   Redis 7    nessun redirect seguito)
                  (ruolo nzt_app  (limiti,   Google token endpoint + JWKS
                   solo DML, TLS)  jti, marker)
```

| Confine | Cosa lo attraversa | Controlli |
| :--- | :--- | :--- |
| **B1** Internet → edge | Tutto il traffico | TLS terminato dall'edge Railway (**NON VERIFICATO**: versione TLS, HSTS lato edge); nessun WAF nel repository |
| **B2** edge → API | Richieste HTTP con `X-Forwarded-For` | `X-Forwarded-For` considerato solo se il peer TCP è in `NZT_TRUSTED_PROXY_CIDRS` (§15); limite body 16 KiB; CORS solo portale; DPoP su ogni endpoint che usa cookie o token |
| **B3** API → dati | SQL, comandi Redis | Ruolo DB solo DML, TLS `verify-full`/`verify-ca` obbligatorio in produzione, `statement_timeout=15s`; Redis su rete privata con password nella URL |
| **B4** API → Internet | Solo chiamate a Google (token, JWKS) | URL fissati da configurazione, `follow_redirects=False`, timeout 10 s; la firma R2 è un calcolo locale (nessun egress) |

---

## 4. Modello delle minacce

### 4.1 Asset

| Asset | Dove vive | Impatto se compromesso |
| :--- | :--- | :--- |
| Password utente | Solo nel body di `register`/`login`; a riposo solo hash Argon2id | Accesso all'account, riuso su altri servizi |
| Refresh token (256 bit) | Cookie HttpOnly; nel DB solo SHA-256 | Inutile senza la chiave DPoP della famiglia |
| Access token (EdDSA, ≤ 10 min) | Memoria della scheda | Inutile senza prove DPoP fresche firmate dalla chiave legata (`cnf.jkt`, `ath`) |
| Chiave privata DPoP del browser | IndexedDB, non estraibile | Usabile solo da codice in esecuzione nell'origin del portale |
| Chiave di firma degli access token (Ed25519) | Variabile d'ambiente | Falsificazione di access token (serve comunque una chiave DPoP coerente con `cnf.jkt`, che chi falsifica sceglie) |
| Chiave dello state OAuth (AES-256) | Variabile d'ambiente | Falsificazione dello state/verifier/nonce OAuth |
| Credenziali storage (sola lettura) | Variabile d'ambiente | Download non autorizzato dei binari |
| Binario del Launcher | Bucket privato | Distribuzione non autorizzata o manomessa |
| Audit dei download (IP, User-Agent) | Tabella `download_logs` | Dato personale |

### 4.2 Attori

| Attore | Capacità assunte |
| :--- | :--- |
| Anonimo remoto | Invia richieste arbitrarie all'API, crea prove DPoP con chiavi proprie, distribuisce richieste su molti IP |
| Utente registrato malevolo | Come sopra, con un account valido senza entitlement |
| Sito terzo malevolo | Fa navigare o inviare form/fetch dal browser della vittima (CSRF) |
| Ladro di token | Ottiene un cookie o un access token (malware, log, proxy), non la chiave non estraibile |
| Script iniettato (XSS) | Esegue JS nell'origin del portale mentre la pagina è aperta |
| Pre-registratore | Registra localmente l'email di una vittima prima che questa usi Google |
| Rete/proxy non fidato | Falsifica `X-Forwarded-For` |

### 4.3 Matrice minaccia → mitigazione → implementazione → verifica

Riferimenti ai test: backend `apps/api/tests/<file>::<test>`, portale `apps/portal/tests/<file>`, E2E = scenario numerato di §22.3.

| # | Minaccia | Mitigazione | Dove | Verifica |
| :--- | :--- | :--- | :--- | :--- |
| T1 | Furto access token (XSS, log) e riuso altrove | Token solo in memoria; DPoP: `cnf.jkt` = thumbprint della prova, `ath` = hash del token, prova firmata dalla chiave non estraibile | `portal/src/auth/tokenStore.ts`, `api/.../deps.py::get_current_user` | `test_dpop::test_resource_jkt_mismatch`, `test_resource_missing_ath`, `test_missing_and_invalid_ath`; `session.test` (web storage mai toccato); E2E 4 |
| T2 | Furto cookie di refresh | Famiglia legata al `jkt`; rotazione richiede prova DPoP con la stessa chiave; mismatch = 401 senza consumare il token | `services/sessions.py::rotate`, `routers/auth.py::refresh` | `test_auth_flows::test_refresh_with_wrong_dpop_key`; E2E 9 |
| T3 | Riuso di un refresh token già ruotato | Reuse detection: revoca di **tutte** le famiglie dell'utente + marker Redis che invalida gli access token già emessi | `services/sessions.py` | `test_reuse_detection_revokes_all_and_kills_access_tokens`, `test_concurrent_double_refresh_exactly_one_wins`, `test_expired_refresh_is_not_reuse` |
| T4 | Replay di una prova DPoP | `jti` monouso (Redis `SET NX`, TTL 125 s), finestra `iat` ±60 s con tipo stretto (`NaN`/`Infinity`/booleani/stringhe/interi enormi ⇒ `401`, mai `500`), `htm`/`htu` legati alla richiesta; JWK in base64url canonico (una sola codifica ⇒ un solo `jkt` per chiave) | `security/dpop.py`, `security/jose_utils.py` | `test_dpop::test_replayed_jti`, `test_proof_replay_at_endpoint`, `test_stale_and_future_iat`, `test_wrong_htm`, `test_wrong_htu_host_path_scheme`; `test_security_fixes::test_l2_dpop_bad_iat_is_invalid_proof`, `test_l2_dpop_bad_iat_is_401_over_http`, `test_l2_dpop_malformed_htu_is_invalid_proof`, `test_i3_non_canonical_jwk_coordinates_rejected` |
| T5 | Confusione di algoritmo/chiave JOSE | Solo `ES256` con JWK EC P-256 pubblica validata sulla curva; access token solo `EdDSA` con `kid` atteso e `typ=at+jwt`; Google solo `RS256` | `security/dpop.py`, `security/tokens.py`, `services/google.py` | `test_alg_none_rejected`, `test_hs256_rejected`, `test_rs256_rejected`, `test_es256_header_with_rsa_jwk_rejected`, `test_jwk_with_private_key_rejected`, `test_jwk_not_p256_rejected`, `test_resource_expired_and_forged_tokens` |
| T6 | CSRF su endpoint con cookie | Header `DPoP` obbligatorio ⇒ preflight CORS ammesso solo dal portale; `SameSite=Strict`; i form cross-site non possono impostare header | `main.py` (CORS), `cookies.py` | `test_http_hardening::test_cors_preflight_portal_only`, `test_auth_flows::test_register_requires_dpop`, `test_auth_flows::test_logout_requires_cookie_and_dpop` |
| T7 | CSRF / login CSRF su OAuth | `state` casuale in cookie AES-256-GCM `HttpOnly`, confronto a tempo costante; `state` **monouso** lato server (Redis `SET NX`); PKCE S256; `nonce` nell'ID token | `routers/google.py`, `security/sealed.py`, `services/google.py` | `test_google::test_state_mismatch_400`, `test_missing_or_forged_state_cookie_400`, `test_pkce_verifier_mismatch_rejected_by_idp`, `test_bad_nonce_rejected`; `test_security_fixes::test_l6_oauth_state_is_single_use` |
| T8 | ID token Google falsificato o per altro client | Firma RS256 via JWKS Google, `iss` in allow-list, `aud` = client id, `exp`/`iat` (leeway 30 s), `email_verified` vero | `services/google.py` | `test_wrong_audience_and_issuer_rejected`, `test_expired_id_token_rejected`, `test_email_not_verified_rejected` |
| T9 | Account pre-hijacking | Nessun collegamento automatico a un account locale non verificato (403); collegamento solo se verificato; un account può avere una sola identità Google (409); email Google canonicalizzata con la **stessa** funzione delle email locali (`schemas.py::canonical_email`) | `routers/google.py::_resolve_user`, `services/google.py` | `test_unverified_local_account_blocked`, `test_existing_verified_account_is_linked`, `test_new_user_created_verified`; `test_security_fixes::test_i5_idn_google_email_links_to_the_local_account`, `test_i5_invalid_google_email_rejected`; E2E 12e. **Residuo:** nessuna verifica email (R-2) |
| T10 | Credential stuffing / brute force | Login 5/min per IP **e** 5/min per email; registrazione 3/h per IP; Google authorize 20/min e callback 10/min per IP; Argon2id costoso | `ratelimit.py`, `routers/auth.py`, `routers/google.py` | `test_ratelimit::test_login_per_ip`, `test_login_per_email`, `test_register_per_ip`; `test_security_fixes::test_l6_google_callback_rate_limited_per_ip`, `test_l6_google_authorize_rate_limited_per_ip`; E2E 14 |
| T11 | Enumerazione account | Login: messaggio unico `Invalid email or password`; registrazione su email esistente: `400 Registration failed` generico | `routers/auth.py` | `test_register_existing_email_generic_failure`, `test_login_happy_path_and_wrong_password` |
| T12 | Timing attack sul login | Verifica Argon2id fittizia (stessi parametri) se l'utente non esiste, è solo-Google o è disattivato | `security/passwords.py::dummy_verify` | `test_login_unknown_user_runs_dummy_verify`, `test_login_google_only_and_inactive_users_dummy_verify` (verificano che la verifica fittizia avvenga, non misurano i tempi) |
| T13 | SQL injection | Solo SQLAlchemy Core/ORM con parametri (prepared statements asyncpg); `text()` solo costanti; ruolo applicativo senza DDL | tutto `src/app`, `scripts/db/roles.sql` | `test_db::test_no_string_built_sql`, `test_raw_text_sql_is_constant`, `test_app_role_cannot_ddl`, `test_migrator_is_not_superuser` |
| T14 | SSRF / egress non controllato | Nessun URL fornito dall'utente raggiunge httpx o boto3; endpoint Google da configurazione; `follow_redirects=False`; presign senza rete | `main.py::build_services`, `services/google.py`, `services/storage.py` | Revisione del codice; nessun test dedicato |
| T15 | Download non autorizzato / path traversal | DPoP + entitlement attivo + 10/h per utente; chiave del bucket solo da enum `Product` lato server; URL prefirmato 300 s | `routers/downloads.py`, `deps.py::require_entitlement`, `services/storage.py` | `test_downloads::test_entitlement_matrix`, `test_entitlement_missing_or_other_product`, `test_catalog_is_server_side_only`, `test_ratelimit::test_downloads_per_user`; E2E 5 |
| T16 | Binario manomesso | SHA-256 restituito dal server e mostrato con istruzioni `Get-FileHash`; audit di ogni URL emesso | `services/storage.py`, `portal/src/components/DownloadCard.tsx` | `test_download_allowed`; E2E 5. **Firma Authenticode non implementata** (O-8) |
| T17 | DoS via Argon2 (CPU/RAM) | Semaforo: max 2 hash/verifiche concorrenti (2 × 64 MiB); coda d'attesa **limitata** (`NZT_ARGON2_MAX_QUEUE`, default 8): oltre ⇒ `503` + `Retry-After: 1` immediato; limiti per IP/email prima di Argon2; body max 16 KiB | `security/passwords.py`, `errors.py`, `middleware.py` | `test_body_size_limit`, `test_body_size_limit_streamed`; `test_security_fixes::test_l4_password_queue_is_bounded_and_fails_fast`; misura dal vivo §22.1 |
| T18 | Spoofing di `X-Forwarded-For` | Header ignorato salvo peer in `NZT_TRUSTED_PROXY_CIDRS`; tutte le righe dell'header unite; solo le 32 voci **più a destra** esaminate, da destra saltando gli hop fidati (nessun numero di voci falsificate a sinistra può scegliere l'IP); uvicorn con `--no-proxy-headers`; in produzione proxy fidati obbligatori salvo opt-in esplicito | `client_ip.py`, `config.py` | `test_client_ip_default_ignores_forwarded_headers`, `test_client_ip_trusted_proxy_chain`, `test_spoofed_xff_cannot_evade_login_limit`, `test_trusted_proxy_xff_used_for_limits_and_audit`; `test_security_fixes::test_m1_*`, `test_i2_all_x_forwarded_for_lines_are_combined` |
| T19 | Indisponibilità di Redis usata per aggirare limiti o anti-replay | Fail-closed: errore Redis ⇒ `503` | `ratelimit.py`, `errors.py` | `test_redis_outage_fails_closed` |
| T20 | XSS nel portale | CSP senza inline, Trusted Types, nessun sink DOM vietato (lint), nessuno script di terze parti | `portal/csp.config.ts`, `portal/eslint.config.js` | `csp.test`; E2E: 0 violazioni CSP/Trusted Types su tutta la suite |
| T21 | Clickjacking | `frame-ancestors 'none'` + `X-Frame-Options: DENY` su API e portale | `middleware.py`, `csp.config.ts` | `test_security_headers_on_every_response`; `csp.test` |
| T22 | Fuga di informazioni negli errori | Errori 422 senza `input`/`ctx`; 500 senza stack trace (generato dentro CORS da `ServerErrorGuardMiddleware`); il portale non mostra mai il `detail` del backend | `errors.py`, `middleware.py`, `portal/src/api/errors.ts` | `test_validation_errors_do_not_echo_input`, `test_unhandled_error_has_no_stacktrace`, `test_secrets_not_in_repr`; `test_security_fixes::test_i6_cors_headers_on_413_429_500`; `errors.test`; E2E 11b |
| T23 | Open redirect dall'URL di autorizzazione | Origin dell'URL di autorizzazione in allow-list (`VITE_OAUTH_AUTHORIZE_ORIGINS`), solo https | `portal/src/lib/safeUrls.ts` | `safeUrls.test` |
| T24 | Corsa tra schede sul refresh (falso positivo di reuse) | Web Lock `nzt_token_refresh` su ogni operazione che usa il cookie; `keepalive` | `portal/src/auth/session.ts`, `portal/src/api/http.ts` | `session.test` (inclusa controprova senza lock); E2E 8, 8f |
| T25 | Utente disattivato con sessioni attive | Ogni richiesta protetta rilegge `users.is_active`; la rotazione rifiuta utenti inattivi | `deps.py`, `services/sessions.py` | `test_dpop::test_resource_inactive_user` |

---

## 5. Modello dati (PostgreSQL 16)

Schema creato da `apps/api/alembic/versions/0001_initial_schema.py` (modelli in `apps/api/src/app/models.py`). Conforme alla specifica §3 salvo la correzione su `download_logs`.

| Tabella | Colonne chiave | Vincoli / indici | Note di sicurezza |
| :--- | :--- | :--- | :--- |
| `users` | `id` UUID, `email` VARCHAR(255), `password_hash` NULL, `is_active`, `is_verified`, `created_at`, `updated_at` | `idx_users_email_lower` UNIQUE su `LOWER(email)` | `password_hash` NULL per account solo Google; `updated_at` aggiornato dall'ORM |
| `auth_identities` | `user_id` → users CASCADE, `provider` (`local`/`google`), `provider_user_id` | UNIQUE(`provider`, `provider_user_id`), `idx_identities_user_id` | `local` → email normalizzata; `google` → `sub` |
| `refresh_token_families` | `user_id` → users CASCADE, `dpop_jkt`, `is_revoked`, `revoked_reason` | `idx_families_user` | `revoked_reason` ∈ {`logout`, `reuse_detected`} (valori scritti dal codice) |
| `refresh_tokens` | `family_id` → families CASCADE, `token_hash` VARCHAR(64), `is_used`, `expires_at` | UNIQUE(`token_hash`), `idx_refresh_token_lookup` | Solo SHA-256 esadecimale del token; mai il valore in chiaro |
| `entitlements` | `user_id` → users CASCADE, `product_code`, `is_enabled`, `valid_until` NULL | UNIQUE(`user_id`, `product_code`), `idx_entitlements_lookup` | `valid_until` NULL = licenza perpetua |
| `download_logs` | `user_id` **NULL** → users **SET NULL**, `product_code`, `ip_address` INET, `user_agent` TEXT, `download_token_id` | `idx_download_audit` (`user_id`, `created_at DESC`) | Audit che sopravvive alla cancellazione dell'utente |

**Correzione `download_logs.user_id` (DEVIAZIONE).** La specifica dichiara `user_id UUID NOT NULL REFERENCES users(id) ON DELETE SET NULL`: le due clausole sono incompatibili (cancellare un utente con download registrati fallirebbe). La colonna è `NULL`-abile con `ON DELETE SET NULL`, così le righe di audit restano dopo la cancellazione dell'utente (`test_downloads::test_audit_rows_survive_user_deletion`).

Altri dettagli:
* Estensione `uuid-ossp` creata dalla migrazione (ruolo migrator, proprietario del DB); i default `uuid_generate_v4()` restano, ma l'applicazione genera comunque gli UUIDv4 in Python.
* La coerenza modelli ↔ migrazione è verificata (`test_db::test_models_match_migrations`, `alembic check`), così come la corrispondenza con la specifica (`test_schema_matches_spec`) e l'unicità case-insensitive dell'email (`test_case_insensitive_unique_email`).
* Il downgrade elimina tabelle ed estensione (`test_migrations_downgrade_base_and_upgrade_head`).

---

## 6. Autenticazione locale

### 6.1 Hashing Argon2id — CONFORME

`apps/api/src/app/security/passwords.py`

| Parametro | Valore | Specifica |
| :--- | :--- | :--- |
| Algoritmo | Argon2id (`argon2.PasswordHasher(type=Type.ID)`) | Argon2id |
| Memoria `m` | 65536 KiB (64 MiB) | 65536 KiB |
| Iterazioni `t` | 3 | 3 |
| Parallelismo `p` | 4 | 4 |
| Salt | 16 byte da `os.urandom` (generato da argon2-cffi a ogni hash) | 16 byte |
| Lunghezza hash | 32 byte | 32 byte |

* Hash e verifica girano in un thread (`asyncio.to_thread`), mai sull'event loop, e sono limitati da un `asyncio.Semaphore(NZT_ARGON2_MAX_CONCURRENCY)` (default **2**): al massimo ~128 MiB di RAM per Argon2 in parallelo. Al massimo `NZT_ARGON2_MAX_QUEUE` (default **8**) chiamate possono **attendere** uno slot; oltre, la chiamata fallisce subito con `503 {"detail":"Service busy, please retry shortly"}` + `Retry-After: 1` (`PasswordHasherBusyError`), uguale per utenti esistenti e inesistenti (nessuna enumerazione). Prima la coda era illimitata: 100 login fasulli in parallelo portavano un login legittimo da ~0,1 s a ~6 s. Il rehash trasparente al login è *best effort*: se la coda è piena viene saltato.
* **AGGIUNTA — rehash trasparente:** al login riuscito, se i parametri dell'hash memorizzato differiscono da quelli correnti (`check_needs_rehash`), l'hash viene ricalcolato e salvato.
* Verificato da `test_openapi_config::test_argon2id_parameters_and_verify`.

### 6.2 Politica password — DEVIAZIONE (più restrittiva)

Applicata in registrazione (`schemas.py::RegisterRequest`, `passwords.py::password_policy_errors`) e replicata identica nel portale (`apps/portal/src/lib/passwordPolicy.ts`, testata su 23 vettori generati eseguendo la funzione del backend):

| Regola | Implementazione |
| :--- | :--- |
| Lunghezza minima | 12 caratteri (code point) |
| Lunghezza massima | 128 (**AGGIUNTA**: limita il costo e la superficie di input) |
| Cifra | almeno una (`\d`, Unicode) |
| Carattere speciale | almeno uno (`[^\w\s]` oppure `_`) |
| Lettera | almeno una (**AGGIUNTA**: impedisce password composte solo da cifre e simboli) |

Il login accetta password da 1 a 128 caratteri (nessuna politica applicata al login, per non rivelare informazioni). Gli errori di politica rispondono `422` con messaggi sanificati che non ripetono l'input.

### 6.3 Prevenzione timing attack ed enumerazione — CONFORME + AGGIUNTA

Flusso di `POST /api/v1/auth/login` (`routers/auth.py`):

1. Rate limit per IP (prima della validazione del body e della prova DPoP).
2. Validazione body (email normalizzata `strip().lower()`, `EmailStr`) e prova DPoP.
3. Rate limit per email normalizzata.
4. `SELECT` per `LOWER(email)`.
5. Se l'utente **non esiste**, **non ha password** (solo Google) oppure è **disattivato** ⇒ `dummy_verify` contro un hash fittizio generato all'avvio con parametri identici, poi `401 {"detail":"Invalid email or password"}`. La specifica richiede il dummy solo per l'utente inesistente: estenderlo ai casi solo-Google e disattivato evita che questi stati siano distinguibili (AGGIUNTA).
6. Verifica Argon2id; in caso di errore stesso `401`.

Registrazione con email già presente (anche con maiuscole diverse, grazie all'indice su `LOWER(email)`): `400 {"detail":"Registration failed"}`, nessun cookie. L'hash Argon2 viene calcolato **prima** dell'inserimento in entrambi i casi, così i tempi sono simili. Resta un'enumerazione residua (201 contro 400) intrinseca a un endpoint che apre subito una sessione; è limitata a 3 tentativi/ora per IP.

Gli account locali nascono con `is_verified = FALSE` e possono comunque effettuare il login (la specifica non lo vieta). Non esiste un flusso di verifica email né di reset password (rischio R-2, §23).

---

## 7. DPoP (RFC 9449)

### 7.1 Lato client (portale)

`apps/portal/src/auth/dpop.ts`, `keyStore.ts`, `keyManager.ts`, `apps/portal/src/api/http.ts`

* **Chiave:** `crypto.subtle.generateKey({name:'ECDSA', namedCurve:'P-256'}, false, ['sign','verify'])`. La chiave privata è **non estraibile**; `toDpopKey` rifiuta una chiave privata estraibile.
* **Persistenza (AGGIUNTA):** la `CryptoKeyPair` è salvata in IndexedDB (database `nzt-portal`, store `dpop-keys`, record `current`) per structured clone, che conserva `extractable=false`. Una chiave per profilo browser, condivisa tra le schede; creazione sotto il lock `nzt_dpop_key` (due schede non generano mai due chiavi). Se IndexedDB non è disponibile la chiave resta solo in memoria (nessuna sessione dopo il reload).
* **Prova:** costruita per ogni richiesta all'API che porta una chiave.

Formato esatto della prova (JWS compatto `base64url(header).base64url(payload).base64url(firma)`):

```json
// header JOSE — solo questi membri
{ "typ": "dpop+jwt", "alg": "ES256",
  "jwk": { "kty": "EC", "crv": "P-256", "x": "<base64url 32 byte>", "y": "<base64url 32 byte>" } }

// payload — endpoint di autenticazione (register, login, refresh, logout, google/callback)
{ "jti": "<crypto.randomUUID()>", "htm": "POST",
  "htu": "https://api.nztsolutions.it/api/v1/auth/refresh", "iat": 1763400000 }

// payload — risorsa protetta (es. GET /api/v1/downloads/launcher): in più "ath"
{ "jti": "...", "htm": "GET", "htu": "https://api.nztsolutions.it/api/v1/downloads/launcher",
  "iat": 1763400000, "ath": "<base64url(SHA-256(access_token))>" }
```

* La firma è l'output grezzo di WebCrypto (IEEE P1363 `r‖s`, 64 byte), che coincide con la codifica JWS ES256; la lunghezza è verificata.
* `htu` = `VITE_API_BASE_URL` + path, senza query né fragment. **`VITE_API_BASE_URL` deve coincidere con `NZT_API_PUBLIC_BASE_URL` del backend**, altrimenti ogni prova fallisce.
* Il thumbprint (RFC 7638) è testato contro il vettore RSA della RFC 7638 e il vettore EC della RFC 9449 (`thumbprint.test`).

### 7.2 Lato server — validazione della prova

`apps/api/src/app/security/dpop.py::DPoPValidator.validate`. Passi, nell'ordine del codice; ogni fallimento produce `401` (§7.4):

| # | Controllo | Dettaglio |
| :--- | :--- | :--- |
| 1 | Presenza e forma | Header `DPoP` presente, ≤ 4096 caratteri, esattamente 3 segmenti |
| 2 | `typ` | Deve essere `dpop+jwt` |
| 3 | `alg` | Deve essere esattamente `ES256` (`none`, HS*, RS*, ES384 rifiutati) |
| 4 | `jwk` | Oggetto JSON; nessun membro privato (`d, p, q, dp, dq, qi, oth, k`); `kty=EC`, `crv=P-256`; `x`/`y` esattamente 43 caratteri base64url **canonici** (alfabeto `[A-Za-z0-9_-]`, niente padding/spazi, bit finali inutilizzati a zero: verificato ricodificando) = 32 byte; punto valido sulla curva. Una chiave ha quindi una sola rappresentazione e un solo `jkt`. Parser proprio, non il loader JWK generico di PyJWT |
| 5 | Firma e claim richiesti | Verifica con la chiave della `jwk` e `algorithms=["ES256"]`; claim obbligatori `jti`, `htm`, `htu`, `iat` |
| 6 | `jti` | Stringa di 8–256 caratteri |
| 7 | `htm` | Uguale al metodo HTTP della richiesta |
| 8 | `htu` | Normalizzato (schema e host minuscoli, porta di default esplicitata, path) e confrontato con `NZT_API_PUBLIC_BASE_URL` + path della richiesta. Query e fragment ignorati. **Mai** derivato da `Host` o `X-Forwarded-*` |
| 9 | `iat` | Numero JSON non booleano, **finito** (`NaN`/`Infinity`, accettati dal parser JSON di Python, rifiutati), nell'intervallo `[0, 2^31)` (gli interi enormi, che farebbero fallire `float()`, sono rifiutati prima di ogni calcolo); `abs(now − iat) ≤ NZT_DPOP_IAT_LEEWAY_SECONDS` (default 60), formulato in modo sicuro rispetto a `NaN`. Ogni tipo errato ⇒ `401`, mai `500`. `htu` non interpretabile (es. IPv6 senza `]`) ⇒ `401` |
| 10 | `ath` | Solo se la richiesta porta un access token: presente e uguale (confronto a tempo costante) a `base64url(SHA-256(token))` |
| 11 | `jkt` | Thumbprint RFC 7638 della JWK pubblica (verificato col vettore RFC 9449 `0ZcOCORZNYy-DWpqq30jZyJGHTN0d2HglBV3uiguA4I`) |
| 12 | Anti-replay | Redis `SET dpop:jti:<sha256(jkt:jti)> 1 NX EX 125` (= 2 × leeway + 5); chiave già presente ⇒ `DPoP proof replayed`. Errore Redis ⇒ `503` (fail-closed) |

`DPoP-Nonce` (opzionale nella RFC) **non** è implementato.

### 7.3 Accesso a risorse protette

`apps/api/src/app/deps.py::get_current_user`, nell'ordine:

1. `Authorization` assente ⇒ `401 {"detail":"Not authenticated"}` + `WWW-Authenticate: DPoP algs="ES256"`.
2. Schema diverso da `DPoP` (es. `Bearer`) ⇒ `401 invalid_token`.
3. Verifica dell'access token (§8.1).
4. Validazione della prova **con** `ath`.
5. `proof.jkt == cnf.jkt`, altrimenti `401 invalid_token`.
6. Marker di revoca Redis `user_revoked_after_ms:{user_id}` e `jkt_revoked_after_ms:{jkt}` (millisecondi, orologio Redis): token con `iat_ms ≤ marker` ⇒ `401` (§9.3).
7. `users.is_active` riletto dal DB a ogni richiesta (AGGIUNTA): utente disattivato ⇒ `401`.

### 7.4 Errori DPoP

| Caso | Stato | Body | `WWW-Authenticate` |
| :--- | :--- | :--- | :--- |
| Prova non valida | 401 | `{"detail":"Invalid DPoP proof"}` | `DPoP error="invalid_dpop_proof", error_description="…", algs="ES256"` |
| Access token non valido, scaduto, revocato o non legato | 401 | `{"detail":"Invalid access token"}` | `DPoP error="invalid_token", error_description="…", algs="ES256"` |
| Nessun `Authorization` | 401 | `{"detail":"Not authenticated"}` | `DPoP algs="ES256"` |

La RFC 9449 consente `400` sugli endpoint di token: si è scelto `401` ovunque per avere un unico percorso d'errore lato client. Le descrizioni sono testi fissi del codice, mai input dell'utente.

---

## 8. Token e cookie

### 8.1 Access token

`apps/api/src/app/security/tokens.py`

| Proprietà | Valore |
| :--- | :--- |
| Formato | JWT firmato **EdDSA (Ed25519)**; chiave `NZT_ACCESS_TOKEN_PRIVATE_KEY_PEM` (PKCS#8 PEM) |
| Header | `{"alg":"EdDSA","typ":"at+jwt","kid":"<thumbprint RFC 7638 della chiave pubblica>"}` |
| Claim | `sub` (UUID utente), `iss` (= `NZT_API_PUBLIC_BASE_URL`), `iat`, `exp`, `jti` (UUIDv4), `cnf: {"jkt": "<thumbprint>"}`, `iat_ms` (AGGIUNTA: istante di emissione in ms sull'orologio Redis, usato solo per ordinare il token rispetto ai marker di revoca, §9.3) |
| TTL | `NZT_ACCESS_TOKEN_TTL_SECONDS`, default **600 s**, ammesso 300–600 |
| Verifica | dimensione ≤ 4096; `alg` = EdDSA e `kid` = chiave corrente; `typ` = `at+jwt`; firma; `iss`; `exp` senza leeway; claim `sub, iss, exp, iat, jti` obbligatori; `cnf.jkt` stringa obbligatoria; tipi stretti: `sub`/`jti` stringhe, `iat`/`exp`/`iat_ms` interi JSON non negativi (niente booleani, float o stringhe); token senza `iat_ms` (emessi prima della correzione) trattati come emessi all'ultimo ms del loro secondo |
| Storage client | Solo memoria della scheda (`createTokenStore`, closure); mai web storage, cookie, URL o log |
| Risposta | `{"access_token": "...", "token_type": "DPoP", "expires_in": 600}` |

In produzione l'avvio fallisce se la chiave manca; in sviluppo/test viene generata una chiave **effimera** con un warning nei log.

### 8.2 Refresh token e cookie

| Proprietà | Valore |
| :--- | :--- |
| Valore | `secrets.token_urlsafe(32)` (32 byte CSPRNG, 43 caratteri base64url) |
| Persistenza server | Solo `SHA-256` esadecimale in `refresh_tokens.token_hash` |
| Scadenza | `NZT_REFRESH_TOKEN_TTL_SECONDS` default **604800 s** (7 giorni), ammesso 3600–604800; **scorrevole**: ogni rotazione emette un token valido altri 7 giorni |
| Legame | La famiglia memorizza il `dpop_jkt` della chiave usata al login/registrazione/callback |

Header esatti, generati esplicitamente da `apps/api/src/app/cookies.py` (nessun attributo `Domain` ⇒ cookie host-only su `api.nztsolutions.it`):

```http
Set-Cookie: __Secure-refresh-token=<43 caratteri base64url>; HttpOnly; Secure; SameSite=Strict; Path=/api/v1/auth; Max-Age=604800
Set-Cookie: __Secure-oauth-state=<sigillo AES-GCM base64url>; HttpOnly; Secure; SameSite=Lax; Path=/api/v1/auth; Max-Age=300
```

Cancellazione: stesso nome e attributi con valore vuoto, `Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT`. Il valore del cookie è vincolato a `[A-Za-z0-9_-]*` prima della scrittura. Attributi verificati byte per byte da `test_auth_flows::test_cookie_attributes_exact` e nel browser reale (E2E 4: HttpOnly, Secure, SameSite=Strict, host-only, path `/api/v1/auth`; `document.cookie` vuoto).

### 8.3 Perché `__Secure-` e non `__Host-` — DEVIAZIONE

La specifica chiede `__Host-refresh-token` e `__Host-oauth-state` con `Path=/api/v1/auth`. I browser accettano un cookie `__Host-` **solo** con `Secure`, senza `Domain` **e con `Path=/`**: con il path della specifica il cookie verrebbe scartato e l'autenticazione non funzionerebbe. Tra le due proprietà incompatibili è stato mantenuto il path ristretto (il cookie viaggia solo verso `/api/v1/auth/*`, mai verso `/api/v1/downloads` o altri path) e si è usato il prefisso `__Secure-` (il cookie può essere impostato solo da un'origine sicura con `Secure`). Il carattere host-only è garantito comunque dall'assenza di `Domain`.

Cosa si perde rispetto a `__Host-`: un altro sottodominio di `nztsolutions.it` compromesso (es. un XSS sulla landing) potrebbe impostare un cookie omonimo con `Domain=nztsolutions.it` (*cookie tossing*). Effetti (revisione indipendente, L5): (a) **login CSRF via Google** — iniettando un `__Secure-oauth-state` ottenuto dall'attaccante e portando la vittima sul callback con `code`/`state` dell'attaccante, la vittima entra nell'account dell'attaccante (sessione legata alla chiave della vittima, identità dell'attaccante); (b) **logout forzato** — un `__Secure-refresh-token` fasullo produce `KEY_MISMATCH` e il portale scarta la chiave. Una *session fixation* del refresh token resta impossibile (la famiglia è legata alla chiave DPoP). Il `state` monouso (§11.2) non chiude (a), perché lo `state` dell'attaccante è ancora inutilizzato. **Punto aperto, decisione utente** (R-18): nomi `__Host-` con `Path=/`, rifiuto dei cookie di autenticazione duplicati, oppure legare lo state al `jkt` del browser che chiama `/authorize`. Mitigazione organizzativa nel frattempo: nessun contenuto controllato da terzi su sottodomini di `nztsolutions.it` e landing aggiornata (advisory Astro, §20).

### 8.4 SameSite e CSRF

* `__Secure-refresh-token` è `SameSite=Strict`: inviato solo su richieste same-site (portale → API, stesso sito `nztsolutions.it`).
* Tutti gli endpoint che usano il cookie (`register`, `login`, `refresh`, `logout`, `google/callback`) richiedono l'header `DPoP`: un header non safelisted forza il preflight CORS, che è accettato solo per gli origin in `NZT_PORTAL_ORIGINS`. Un form HTML cross-site non può impostare header.
* `__Secure-oauth-state` è `SameSite=Lax` come da specifica; il suo contenuto è sigillato AES-256-GCM e confrontato a tempo costante (§11).

---

## 9. Refresh Token Rotation, reuse detection, revoca e logout

### 9.1 Rotazione atomica

`apps/api/src/app/services/sessions.py::SessionService.rotate`. Un'unica istruzione condizionale consuma il token:

```sql
UPDATE refresh_tokens SET is_used = TRUE
FROM refresh_token_families f
WHERE token_hash = :h AND is_used = FALSE AND expires_at > now()
  AND f.id = family_id AND f.is_revoked = FALSE AND f.dpop_jkt = :jkt
RETURNING family_id, f.user_id;
```

Se una riga è restituita: si controlla che l'utente sia attivo (altrimenti rollback e `401`), si inserisce il nuovo token nella stessa famiglia e si fa commit nella stessa transazione; si emette un nuovo access token legato allo stesso `jkt`. Il lock di riga di PostgreSQL con READ COMMITTED garantisce che, tra N richieste concorrenti con lo stesso token, **una sola** vinca.

### 9.2 Classificazione dei fallimenti

Se nessuna riga è consumata, la riga viene riletta (dopo l'eventuale vincitore concorrente) e classificata in quest'ordine:

| Stato rilevato | Esito | Risposta | Effetti |
| :--- | :--- | :--- | :--- |
| Token sconosciuto o malformato (non 43 caratteri base64url) | INVALID | `401 Invalid refresh token` + cookie cancellato | Nessuno |
| `is_used = TRUE` | **REUSE** | `401 Refresh token reuse detected` + cookie cancellato | **Tutte** le famiglie non revocate dell'utente ⇒ `is_revoked=TRUE, revoked_reason='reuse_detected'`; commit; poi marker Redis `user_revoked_after_ms:{user_id}` = ora Redis in ms (TTL = TTL access + 5 s, §9.3); log `SECURITY: refresh token reuse detected` |
| Famiglia revocata | REVOKED | `401 Invalid refresh token` + cookie cancellato | Nessuno |
| Scaduto | EXPIRED | `401 Invalid refresh token` + cookie cancellato | **Non** è riuso: token non consumato, famiglia non revocata |
| `jkt` della prova ≠ `dpop_jkt` della famiglia | KEY_MISMATCH | `401 DPoP key does not match refresh token binding` + `WWW-Authenticate: DPoP error="invalid_dpop_proof"` | Token **non** consumato, famiglia **non** revocata, cookie **non** cancellato |
| Cookie assente | — | `401 Missing refresh token` | — |

Nota: un token già usato presentato con una chiave diversa è classificato REUSE (il controllo `is_used` precede il controllo della chiave e della scadenza): chi ripresenta un cookie vecchio rubato fa scattare la revoca totale. Conseguenza (revisione indipendente, L1, **non corretta: decisione utente**): un singolo valore storico di refresh token già usato — anche scaduto, con qualunque chiave — revoca tutte le sessioni della vittima, ripetibile all'infinito (le righe usate non vengono mai eliminate). Vedi R-21.

### 9.3 Marker di revoca (AGGIUNTA)

Gli access token sono stateless; per renderli invalidabili prima della scadenza l'API usa due marker Redis, controllati a ogni richiesta protetta:

| Chiave | Scritta da | Effetto | TTL |
| :--- | :--- | :--- | :--- |
| `user_revoked_after_ms:{user_id}` | Reuse detection | Rifiuta ogni access token dell'utente con `iat_ms ≤ marker` | TTL access + 5 s (605 s di default) |
| `jkt_revoked_after_ms:{jkt}` | Logout | Rifiuta ogni access token legato a quella chiave con `iat_ms ≤ marker` | TTL access + 5 s |

**Ordinamento al millisecondo su un unico orologio (correzione L3).** Prima marker e `iat` erano in secondi interi con confronto `≤`: un login legittimo nello **stesso secondo** di un logout o di una reuse detection riceveva un token già revocato. Ora:
* il marker è scritto da uno script Lua che legge `TIME` di Redis **dopo** l'`UPDATE` di revoca (logout: dopo il commit; reuse: con i lock di riga ancora tenuti, commit subito dopo) e conserva il massimo tra valore esistente e nuovo (non arretra mai);
* ogni access token porta `iat_ms` = `TIME` di Redis letto **prima** del lavoro DB che lo emette (consumo del refresh token in `rotate`, creazione della famiglia in `create_session`);
* revocato ⇔ `iat_ms ≤ marker`.

Quindi un token il cui consumo è avvenuto prima dell'`UPDATE` di revoca è sempre rifiutato (il suo istante precede il marker); un consumo successivo non può riuscire (famiglia revocata; uno concorrente attende il lock di riga e poi fallisce); un token emesso dopo la revoca è accettato anche nello stesso secondo; l'unico caso ambiguo (stesso millisecondo) è rifiutato (fail-closed). L'orologio Redis elimina la deriva tra repliche dell'API. `iat`/`exp` restano in secondi dall'orologio locale (validati da PyJWT). Compatibilità: i marker legacy in secondi (`user_revoked_after:*`, `jkt_revoked_after:*`, scritti da una replica non ancora aggiornata durante un deploy) sono ancora letti con la semantica precedente; scadono entro 605 s. Verificato da `test_reuse_detection_revokes_all_and_kills_access_tokens`, `test_security_fixes::test_l3_*` (orologio locale congelato: il re-login nello stesso secondo è accettato, il token precedente resta revocato) e, nel browser, da E2E 7 (marker legacy `jkt` ⇒ `launcher:401, refresh:200, launcher:200`).

### 9.4 Logout (AGGIUNTA: contratto)

La specifica cita `/logout` senza definirne il contratto. Implementato `POST /api/v1/auth/logout` (`routers/auth.py`, `sessions.py::logout`):

* Richiede cookie di refresh + prova DPoP; nessun body.
* Cookie assente ⇒ `401 Missing refresh token`.
* Token malformato o sconosciuto ⇒ `204` (idempotente) con cookie cancellato.
* Chiave della prova ≠ chiave della famiglia ⇒ `401 Invalid DPoP proof` (`invalid_dpop_proof`).
* Altrimenti: famiglia revocata (`revoked_reason='logout'`), marker `jkt_revoked_after_ms:{jkt}`, cookie cancellato, `204` senza body.

Lato portale (`session.ts::logout`): sotto il lock `nzt_token_refresh` chiama il logout, poi **elimina la chiave da IndexedDB anche se il server non è raggiungibile** (ogni cookie legato a quella chiave diventa definitivamente inutilizzabile), azzera la memoria e notifica le altre schede via `BroadcastChannel('nzt_auth')` con il solo messaggio `logout`. Verificato da `test_auth_flows::test_logout` e E2E 10 (204 con DPoP, chiave eliminata, cookie cancellato, altra scheda disconnessa, famiglia `logout`, replay del cookie precedente ⇒ 401).

Effetto collaterale noto: se la stessa chiave del browser possiede più famiglie, il marker `jkt` invalida gli access token di tutte; i loro refresh token restano validi.

---

## 10. Concorrenza

### 10.1 Il problema

Con RTR senza finestra di tolleranza (la specifica non ne prevede), due rotazioni **concorrenti** presentano lo stesso cookie: il server ne accetta una e tratta l'altra come riuso (§9.2), revocando **tutte** le sessioni dell'utente. Il vincitore stesso perde la sessione appena ottenuta. È corretto dal punto di vista della sicurezza ma va evitato dal client.

### 10.2 Lato client — CONFORME + AGGIUNTE

`apps/portal/src/auth/session.ts`, `src/lib/locks.ts`, `src/api/http.ts`

| Meccanismo | Dettaglio |
| :--- | :--- |
| Web Lock `nzt_token_refresh` | `navigator.locks.request('nzt_token_refresh', {mode:'exclusive'}, …)` serializza **ogni** operazione che legge o riscrive il cookie (login, register, callback Google, refresh, logout) tra tutte le schede, non solo il refresh come richiesto dalla specifica |
| Deduplica nella scheda | Chiamate concorrenti a `refresh()` nella stessa scheda condividono una sola promise |
| Rotazioni sequenziali | Dopo aver preso il lock ogni scheda fa la propria rotazione (gli access token sono per-scheda e non vengono mai condivisi); è sicuro perché il browser ha già salvato il cookie ruotato dal detentore precedente |
| Lock `nzt_dpop_key` | Creazione della chiave serializzata: una sola chiave per profilo |
| `keepalive: true` | Su tutte le richieste credenziali `/api/v1/auth/*`: se la pagina viene ricaricata o chiusa a metà rotazione, il browser completa la richiesta e salva il nuovo cookie |
| Pianificazione | Refresh silenzioso all'avvio solo se esiste una chiave; rinnovo a `expires_in − 60 s` (minimo 5 s) e su `visibilitychange`; su `401` di una risorsa: un refresh e un solo nuovo tentativo |
| Ripiego | Senza Web Locks API: mutex FIFO limitato alla scheda (non protegge tra schede, rischio residuo R-11) |

**Scoperta E2E (keepalive).** Senza `keepalive`, una navigazione durante un refresh in volo interrompeva la `fetch` dopo che il server aveva già ruotato: il browser non salvava il nuovo cookie, la pagina successiva presentava quello consumato e la reuse detection revocava tutte le sessioni (3/3 esecuzioni fallite, 12 navigazioni interrotte ciascuna). Con `keepalive`: 5/5 esecuzioni superate. Resta una finestra teorica di pochi millisecondi (il lock viene rilasciato alla distruzione del documento mentre la richiesta keepalive è ancora in volo): vedi R-4 e la decisione aperta O-P1.

### 10.3 Lato server

* Rotazione atomica a singola istruzione (§9.1): esattamente un vincitore (`test_concurrent_double_refresh_exactly_one_wins`).
* Rate limit di 30 rotazioni/min per famiglia (§14).
* Nessuna finestra di grazia: decisione utente pendente (O-P1, §23).

Evidenze: `session.test` "serializes refreshes across tabs" (4 schede × 2 round senza sovrapposizioni) e la controprova "WITHOUT the lock concurrent tabs trip the reuse detection"; E2E 8 (3 reload concorrenti di 2 schede = 6 refresh, tutti 200, 0 famiglie revocate) ed E2E 8f (12 navigazioni che interrompono il refresh di avvio, nessuna reuse detection).

---

## 11. Google OIDC, PKCE, state, nonce e collegamento account

`apps/api/src/app/routers/google.py`, `services/google.py`, `security/sealed.py`; portale `src/components/GoogleButton.tsx`, `src/pages/GoogleCallbackPage.tsx`, `src/lib/oauthCallback.ts`.

### 11.1 Flusso

```
Portale                         API                                  Google
   │ GET /api/v1/auth/google/authorize (credentials: include)          │
   │──────────────────────────────►│ state=token_urlsafe(32)            │
   │                               │ verifier=token_urlsafe(64) (86 c.) │
   │                               │ nonce=token_urlsafe(32)            │
   │ 200 {"authorization_url":…}   │ Set-Cookie __Secure-oauth-state =  │
   │◄──────────────────────────────│  AES-256-GCM{state,verifier,nonce,exp}
   │ origin URL ∈ allow-list? ──► location.assign(url) ─────────────────►│
   │◄──────────── redirect /auth/google/callback?code&state ─────────────│
   │ legge code/state una volta, history.replaceState (URL ripulito)     │
   │ POST /api/v1/auth/google/callback {code,state} + DPoP + cookie      │
   │──────────────────────────────►│ 1 DPoP  2 state cookie  3 exchange │
   │                               │──── POST token (code, verifier, ──►│
   │                               │      client_secret)                │
   │                               │◄─── id_token ──────────────────────│
   │                               │ 4 verifica id_token (JWKS)         │
   │                               │ 5 collegamento account (§11.3)     │
   │ 200 token + refresh cookie,   │                                    │
   │ state cookie cancellato       │                                    │
```

### 11.2 Controlli

| Fase | Controllo | Errore |
| :--- | :--- | :--- |
| Authorize / Callback | Rate limit per IP (20/min authorize, 10/min callback; §14), valutato per primo | `429` + `Retry-After` |
| Authorize | Google non configurato (`client_id`/`secret` assenti) | `503 Google sign-in not configured` |
| Authorize | Parametri: `response_type=code`, `client_id`, `redirect_uri`, `scope=openid email profile`, `state`, `nonce`, `code_challenge`, `code_challenge_method=S256` | — |
| Authorize (portale) | Origin dell'URL ∈ `VITE_OAUTH_AUTHORIZE_ORIGINS` (default `https://accounts.google.com`), solo https | Messaggio d'errore, nessuna navigazione |
| Callback | Prova DPoP valida (prima di tutto) | `401` (cookie di state **non** cancellato) |
| Callback | Cookie di state presente, decifrabile (AAD `nzt-oauth-state-v1`, nonce GCM 12 byte), con campi tipizzati | `400 Invalid OAuth state` |
| Callback | `exp` del sigillo non superato (300 s) | `400 OAuth state expired` |
| Callback | `state` del body = `state` del sigillo, confronto a tempo costante | `400 Invalid OAuth state` (Google non viene contattato) |
| Callback | `state` **monouso**: `SET oauth_state_used:<sha256(state)> 1 NX EX 360`; già consumato ⇒ rifiuto prima di contattare Google; errore Redis ⇒ `503` (fail-closed) | `400 OAuth state already used` |
| Scambio codice | POST al token endpoint con `code_verifier` e client secret | non-200 ⇒ `400 Authorization code exchange failed`; errore di rete ⇒ `502 Identity provider unavailable`; JSON non valido ⇒ `502` |
| ID token | Solo `RS256`; `kid` presente; chiave dal JWKS Google (cache 1 h, rilettura su `kid` sconosciuto al massimo ogni 60 s; scartate chiavi non RSA o con membri privati) | `400` / `502` se JWKS non disponibile |
| ID token | `iss` ∈ `NZT_GOOGLE_ISSUERS`, `aud` = client id, `exp`/`iat` (leeway 30 s), claim `iss, aud, exp, iat, sub` obbligatori | `400 Invalid id_token` |
| ID token | `nonce` = nonce del sigillo (tempo costante) | `400 Invalid id_token nonce` |
| ID token | `email_verified` esattamente `true`; `sub` non vuoto, ≤ 255; `email` canonicalizzata con la **stessa** funzione delle email locali (`schemas.py::canonical_email`: trim, minuscole, `email-validator` con NFC e dominio IDNA `xn--` convertito nella forma Unicode, ≤ 255); email non valida | `400 Google account email is not verified` / `400 id_token has no usable email` |

Il cookie di state viene cancellato a ogni esito del callback tranne il `401` DPoP e il `429`; lo `state` è comunque consumato lato server al primo callback valido, quindi un cookie+state ripresentato non raggiunge più il token endpoint di Google.

**Decisione IDN/Unicode (I5).** Le email (locali e Google) sono salvate e confrontate nella forma restituita da `email-validator`: dominio in Unicode (`victim@xn--exmple-cua.com` ⇒ `victim@exämple.com`), NFC, minuscole; la parte locale non viene ulteriormente normalizzata (niente NFKC, niente rimozione di `+tag` o punti). Chiave di ricerca DB, chiave del rate limit per email e `users.email` sono la stessa stringa. Lato portale, `code`/`state`/`error` sono letti una sola volta a livello di modulo e l'URL viene subito ripulito con `history.replaceState`; la POST di callback è una sola per caricamento di pagina; `Referrer-Policy: no-referrer` impedisce che il codice finisca in header `Referer` (E2E 12b, 12d).

### 11.3 Collegamento account e pre-hijacking — CONFORME + AGGIUNTE

Ordine di risoluzione in `_resolve_user`:

| Caso | Esito |
| :--- | :--- |
| Identità `google`/`sub` già collegata, utente attivo | Login su quell'utente |
| Identità collegata, utente disattivato | `403 Account is disabled` (AGGIUNTA) |
| Email esistente, utente disattivato | `403 Account is disabled` (AGGIUNTA) |
| Email esistente con `is_verified = FALSE` | **`403`** "An account with this email already exists but is not verified. Verify the local account before signing in with Google." Nessun collegamento, nessuna sessione (**CONFORME** a §5.3) |
| Email esistente verificata, già collegata a un **altro** `sub` Google | `409 Account already linked to a different Google identity` (AGGIUNTA) |
| Email esistente verificata | Inserimento `auth_identities(google, sub)` e login (**CONFORME**) |
| Email nuova | Nuovo utente `is_verified=TRUE`, `password_hash=NULL` + identità Google (**CONFORME**) |
| Conflitto di unicità concorrente | `409 Account linking conflict, please retry` |

Limite noto: non esistendo un flusso di verifica email, un account locale non è mai verificato; quindi il collegamento a Google di un account locale preesistente **non è attualmente possibile**, e un pre-registratore può occupare l'email di una vittima impedendole l'accesso con Google (R-2). Il `403` rivela inoltre che esiste un account locale per quell'email (verificata da Google): intrinseco alla regola della specifica.

---

## 12. Distribuzione protetta del Launcher

`apps/api/src/app/routers/downloads.py`, `deps.py::require_entitlement`, `services/storage.py`; portale `src/components/DownloadCard.tsx`.

```
GET /api/v1/downloads/launcher   (Authorization: DPoP <AT> + DPoP con ath)
   │
   ├─ 1. get_current_user (§7.3)                       ── 401
   ├─ 2. rate limit 10/h per utente                     ── 429
   ├─ 3. require_entitlement("launcher_core")           ── 403
   │      is_enabled AND (valid_until IS NULL OR valid_until > now())
   ├─ 4. INSERT download_logs(user_id, product_code, ip_address,
   │      user_agent[:512], download_token_id = 128 bit hex)  → COMMIT
   └─ 5. presign SigV4 GET (boto3, calcolo locale HMAC-SHA256, ExpiresIn=300,
          ResponseContentDisposition=attachment; filename="NZT-Launcher.exe")
   ▼
200 {"download_url": "...X-Amz-Signature=...", "sha256": "<64 hex>", "version": "1.0.0", "expires_in": 300}
```

| Requisito specifica | Implementazione |
| :--- | :--- |
| Nessun URL statico pubblico | Bucket privato; solo URL prefirmati di 300 s |
| Mappatura solo da enumerazioni server | Chiave oggetto `binaries/launcher/v{NZT_LAUNCHER_VERSION}/NZT-Launcher.exe` dall'enum `Product` + configurazione; versione validata `^\d{1,4}\.\d{1,4}\.\d{1,4}$` all'avvio; l'endpoint non dichiara parametri (eventuali query ignorate) — `test_catalog_is_server_side_only` |
| Audit per ogni download autorizzato | Riga in `download_logs` **committata prima** di generare l'URL; `download_token_id` non restituito (risposta identica alla specifica) |
| Verifica integrità SHA-256 | Hash da `NZT_LAUNCHER_SHA256` (produzione rifiuta il default di zeri). Il portale valida che sia 64 hex e l'URL https, mostra hash, pulsante di copia e istruzioni `Get-FileHash`; **non può verificare il file scaricato** (R-4). Il Launcher/installer non è nel repository |
| `require_entitlement(product_code)` | Factory di dependency in `deps.py` |

Lato portale il link è generato **solo su richiesta** ("Prepara il download"), perché ogni chiamata scrive una riga di audit e consuma il limite orario; l'ancora usa `rel="noopener noreferrer"` e `referrerPolicy="no-referrer"`; alla scadenza il link viene rimosso. L'URL prefirmato è un *bearer link*: chiunque lo possieda nei 300 s può scaricare; l'audit registra chi lo ha richiesto.

**Nota R2 (O-3):** gli URL prefirmati SigV4 di Cloudflare R2 funzionano sull'host API S3 (`<account>.r2.cloudflarestorage.com`), non su domini personalizzati: `NZT_STORAGE_ENDPOINT_URL` va impostato di conseguenza (il default `https://storage.nztsolutions.it` va sovrascritto). **NON VERIFICATO** con R2 reale.

---

## 13. Hardening HTTP

### 13.1 Header dell'API — CONFORME + AGGIUNTA

`apps/api/src/app/middleware.py::SecurityHeadersMiddleware` è un middleware ASGI puro e il più esterno: gli header sono presenti su **ogni** risposta, inclusi preflight CORS, 4xx, 413 e 500.

```http
Strict-Transport-Security: max-age=63072000; includeSubDomains; preload
X-Content-Type-Options: nosniff
X-Frame-Options: DENY
Referrer-Policy: strict-origin-when-cross-origin
Permissions-Policy: camera=(), microphone=(), geolocation=()
Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; connect-src 'self' https://accounts.google.com https://oauth2.googleapis.com https://api.nztsolutions.it https://clienti.nztsolutions.it https://storage.nztsolutions.it; frame-ancestors 'none'; base-uri 'self'; form-action 'self';
Cache-Control: no-store
```

* La CSP è quella della specifica con `connect-src` costruito da configurazione (API, portale/i, `NZT_STORAGE_PUBLIC_ORIGIN`) invece del wildcard `https://*.nztsolutions.com`. Protegge solo eventuali documenti serviti dall'API (es. `/docs` in sviluppo): la CSP che conta per il browser dell'utente è quella del portale (§13.4).
* `Cache-Control: no-store` (AGGIUNTA): le risposte contengono token e URL prefirmati.

### 13.2 CORS

`apps/api/src/app/main.py`: `allow_origins = NZT_PORTAL_ORIGINS` (default solo `https://clienti.nztsolutions.it`), `allow_credentials=True`, metodi `GET, POST`, header `Authorization, Content-Type, DPoP`, unico header esposto `Retry-After` (`expose_headers=["Retry-After"]`), `max_age=600`. Un preflight da un origin non ammesso riceve `400` (`test_cors_preflight_portal_only`).

Ordine dei middleware (dall'esterno): `SecurityHeaders → CORS → ServerErrorGuard → BodySizeLimit → app`. Anche il `413` del limite body e il `500` generico passano quindi da CORS: per gli origin ammessi tutte le risposte d'errore (413, 429, 500, 503) sono leggibili dal portale, che mostra l'attesa reale indicata da `Retry-After` (es. "Riprova tra 25 secondi."; `test_cors_simple_request_exposes_only_retry_after`, `test_security_fixes::test_i6_cors_headers_on_413_429_500`, E2E 14b/14c).

### 13.3 Altre protezioni dell'API

| Protezione | Dettaglio | Test |
| :--- | :--- | :--- |
| Limite body | `NZT_MAX_REQUEST_BODY_BYTES` = 16384: controllo `Content-Length` e conteggio in streaming ⇒ `413 {"detail":"Request body too large"}` | `test_body_size_limit`, `test_body_size_limit_streamed` |
| Modelli stretti | `extra="forbid"`, stringhe ≤ 4096; email ≤ 255, password ≤ 128, `code` ≤ 2048, `state` ≤ 256 | `test_openapi_matches_spec_section_8` |
| Errori 422 sanificati | `{"detail":[{loc,msg,type}]}` senza `input`/`ctx` (le password non vengono mai ripetute) | `test_validation_errors_do_not_echo_input` |
| Errori 500 | `{"detail":"Internal server error"}`; eccezione registrata solo lato server; generato da `ServerErrorGuardMiddleware` dentro CORS (la guardia di `SecurityHeadersMiddleware` resta come ultima difesa) | `test_unhandled_error_has_no_stacktrace`, `test_i6_cors_headers_on_413_429_500` |
| Coda Argon2 piena | `503 {"detail":"Service busy, please retry shortly"}` + `Retry-After: 1` | `test_l4_password_queue_is_bounded_and_fails_fast` |
| Documentazione | `/docs`, `/openapi.json` disattivati con `NZT_ENVIRONMENT=production` (404); `/redoc` sempre disattivato | `test_docs_disabled_in_production` |
| Liveness | `GET /healthz`: `SELECT 1` + `PING` Redis ⇒ `200 {"status":"ok"}` / `503` | `test_healthz` |

### 13.4 Header e CSP del portale — AGGIUNTA (più restrittiva della specifica)

Fonte unica `apps/portal/csp.config.ts`; `vite preview` invia esattamente gli header di produzione; `deploy/_headers` e `deploy/Caddyfile` sono verificati uguali da `csp.test`.

```http
Content-Security-Policy: default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self'; font-src 'self'; connect-src https://api.nztsolutions.it; manifest-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'; object-src 'none'; require-trusted-types-for 'script'; trusted-types 'none'
X-Robots-Tag: noindex, nofollow, noarchive
Referrer-Policy: no-referrer
X-Content-Type-Options: nosniff
X-Frame-Options: DENY
Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=(), usb=()
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Resource-Policy: same-origin
Strict-Transport-Security: max-age=63072000; includeSubDomains; preload
```

* **Nessun `'unsafe-inline'`**, nemmeno per gli stili: React applica gli stili dinamici via CSSOM; `index.html` non contiene script o stili inline (verificato da `csp.test`). Il plugin React di Vite non è usato perché inietterebbe uno script inline in sviluppo.
* **Trusted Types** imposti (`trusted-types 'none'`): nessun sink DOM-XSS utilizzabile nei browser Chromium. E2E: 0 eventi `securitypolicyviolation` sull'intera suite.
* `connect-src` contiene solo l'origin dell'API; il redirect a Google e il download R2 sono navigazioni, non `fetch`. `modulePreload.polyfill: false` evita `fetch` same-origin.
* In sviluppo (`vite dev`) le sole deroghe sono `style-src 'unsafe-inline'`, `connect-src 'self' ws:` (HMR) e nessun Trusted Types.
* **Non indicizzabile:** `X-Robots-Tag`, `<meta name="robots" content="noindex, nofollow, noarchive">`, `robots.txt` con `Disallow: /`, `<meta name="referrer" content="no-referrer">`. I meta tag sono solo difesa in profondità: CSP, `frame-ancestors` e `X-Robots-Tag` **devono** arrivare come header HTTP dall'hosting statico.
* Asset con hash: `Cache-Control: public, max-age=31536000, immutable`; documenti `no-cache` (Caddyfile).

---

## 14. Rate limiting

`apps/api/src/app/ratelimit.py`. Algoritmo *sliding window counter*: due bucket a finestra fissa (corrente e precedente, quest'ultimo pesato per la frazione ancora sovrapposta), controllo e incremento in un unico script Lua atomico che usa l'orologio del server Redis. Chiavi `rl:<regola>:<sha256(identificatore)[:32]>` (nessun dato personale in chiaro), scadenza `2 × finestra`. I valori sono quelli della specifica (più i due limiti Google, AGGIUNTA) e sono **costanti nel codice**, non configurabili da env.

| Endpoint | Limite | Chiave | Momento della valutazione |
| :--- | :--- | :--- | :--- |
| `POST /api/v1/auth/login` | 5 / 60 s | IP client (§15) | Prima della validazione del body e della prova DPoP: anche le richieste non valide contano |
| `POST /api/v1/auth/login` | 5 / 60 s | Email normalizzata | Dopo body e DPoP, prima della query e di Argon2 |
| `POST /api/v1/auth/register` | 3 / 3600 s | IP client | Prima di body e DPoP |
| `POST /api/v1/auth/refresh` | 30 / 60 s | Famiglia (`family:<id>` cercata per hash del cookie); cookie sconosciuto/malformato ⇒ `anon:<ip>` | Prima della prova DPoP |
| `GET /api/v1/downloads/launcher` | 10 / 3600 s | ID utente | Dopo l'autenticazione DPoP, prima del controllo entitlement |
| `GET /api/v1/auth/google/authorize` | 20 / 60 s (**AGGIUNTA** alla §9.2 della specifica) | IP client | Prima di tutto (cookie di state e URL non generati se superato) |
| `POST /api/v1/auth/google/callback` | 10 / 60 s (**AGGIUNTA**) | IP client | Prima di body e prova DPoP: limita i POST server-side verso il token endpoint di Google |
| `POST /api/v1/auth/logout`, `GET /healthz` | **nessuno** | — | Punto aperto O-9 (logout richiede cookie + prova DPoP della famiglia) |

* Superamento ⇒ `429 {"detail":"Too many requests"}` + `Retry-After: <secondi>` (calcolato dallo script, minimo 1).
* **Fail-closed (DEVIAZIONE/AGGIUNTA):** errore Redis ⇒ `503 {"detail":"Service temporarily unavailable"}` + `Retry-After: 5`. Vale anche per lo store anti-replay DPoP e per i marker di revoca: senza Redis nessun endpoint con DPoP risponde. Scelta deliberata: gli endpoint di autenticazione e download non devono mai diventare illimitati o riproducibili.
* **DEVIAZIONE di forma:** la specifica parla di middleware; i limiti sono **dependency FastAPI** perché le chiavi richiedono identità già interpretate (email, famiglia, utente).
* Valori Google scelti così: `authorize` è economico (nessun egress) ma imposta un cookie, 20/min lascia margine a più schede/tentativi dietro uno stesso NAT; `callback` costa un POST verso Google, 10/min è il doppio del login per IP. Stesso algoritmo e stesso fail-closed (`503`) degli altri limiti.
* Verifica: `test_spec_values_are_exact`, un test per ogni regola (inclusi `test_l6_google_callback_rate_limited_per_ip`, `test_l6_google_authorize_rate_limited_per_ip`), `test_sliding_window_recovers`, `test_redis_outage_fails_closed`; E2E 14 (`401×5, 429` con messaggio "Riprova tra N secondi").

---

## 15. IP client e proxy fidati

`apps/api/src/app/client_ip.py`. L'IP del client alimenta i limiti per IP e la colonna `download_logs.ip_address`.

* Default (`NZT_TRUSTED_PROXY_CIDRS` vuoto): si usa il peer TCP; `X-Forwarded-For` è **ignorato**.
* Con CIDR configurati: l'header è considerato solo se il peer TCP appartiene a un CIDR fidato; **tutte** le righe `X-Forwarded-For` sono unite nell'ordine ricevuto (RFC 9110 §5.3; prima si leggeva solo la prima riga, I2); si esaminano solo le **32 voci più a destra** (budget di parsing 8 KiB, sempre dalla destra), lette **da destra a sinistra** saltando gli hop fidati; il primo indirizzo non fidato è il client. Voci non interpretabili ⇒ si usa l'ultimo indirizzo fidato; 32 hop tutti fidati ⇒ il più a sinistra tra quelli esaminati. Le voci aggiunte dal client a sinistra sono quindi irrilevanti, qualunque sia il loro numero. **Correzione M1:** prima la catena era troncata con `[:32]`, cioè alle 32 voci più a **sinistra** (controllate dal client): con ≥ 32 voci falsificate l'IP reale usciva dalla finestra e il client sceglieva il proprio IP, aggirando tutti i limiti per IP e falsificando `download_logs.ip_address` (dal vivo: 8 registrazioni su 8 accettate invece di 3).
* Produzione: è obbligatorio `NZT_TRUSTED_PROXY_CIDRS` **oppure** l'opt-in esplicito `NZT_DIRECT_CLIENT_CONNECTIONS=true` (nessun proxy davanti all'API); nessuno dei due o entrambi ⇒ l'avvio fallisce (§17.1).
* Nessun peer noto ⇒ `0.0.0.0` (segnaposto per l'audit).
* **uvicorn va avviato con `--no-proxy-headers`**, altrimenti riscriverebbe da sé il peer prima della logica sopra.

Configurazione errata = rischio: CIDR vuoto dietro un proxy ⇒ tutti gli utenti condividono l'IP del proxy (limiti per IP troppo severi, audit inutile); un CIDR troppo ampio ⇒ spoofing possibile. Il range dell'edge Railway va verificato sul traffico reale (O-4; `.env.example` riporta `100.64.0.0/10` solo come esempio, **NON VERIFICATO**).

---

## 16. Database: privilegio minimo, TLS, migrazioni, SQL injection

### 16.1 Ruoli — CONFORME

`apps/api/scripts/db/roles.sql` (eseguito una volta da un amministratore con le variabili psql `db_name`, `migrator_password`, `app_password`):

| Ruolo | Attributi | Permessi |
| :--- | :--- | :--- |
| `nzt_migrator` | `LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION` | Proprietario del database e dello schema `public`; esegue Alembic (DDL) |
| `nzt_app` | `LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOINHERIT` | `CONNECT` sul DB, `USAGE` sullo schema; `SELECT, INSERT, UPDATE, DELETE` su tutte le tabelle create dal migrator (`ALTER DEFAULT PRIVILEGES`); `statement_timeout=15s`, `idle_in_transaction_session_timeout=30s` |

`REVOKE ALL ON DATABASE … FROM PUBLIC` e `REVOKE ALL ON SCHEMA public FROM PUBLIC`. Verificato che `nzt_app` non può `CREATE TABLE/SCHEMA/FUNCTION/INDEX/TEMP`, `DROP`, `ALTER`, `TRUNCATE` (`test_app_role_cannot_ddl`) e che il migrator non è superuser (`test_migrator_is_not_superuser`). Il ruolo applicativo ha DML anche su `alembic_version` (innocuo).

### 16.2 Migrazioni

Alembic usa **solo** `NZT_MIGRATIONS_DATABASE_URL` (ruolo migrator; ripiego su `NZT_DATABASE_URL` se assente fuori produzione — in produzione la variabile è **obbligatoria per Alembic**: senza, il comando fallisce con un errore esplicito e non ripiega sul ruolo runtime; **non** è richiesta né desiderata dall'API, che non deve detenere le credenziali del migrator). Vanno eseguite come passo separato prima del deploy dell'API, mai dal processo applicativo.

### 16.3 TLS verso PostgreSQL — CONFORME

`apps/api/src/app/db.py`: `NZT_DATABASE_SSLMODE` ∈ `disable | require | verify-ca | verify-full`; default `verify-full` in produzione, `disable` altrove; TLS minimo 1.2; CA da `NZT_DATABASE_SSL_ROOT_CERT`. In produzione l'avvio fallisce con qualunque valore diverso da `verify-full` (`verify-ca`, `require` e `disable` rifiutati, come chiede la specifica). Disponibilità di TLS con nome host certificato sulla rete privata Railway: **NON VERIFICATO** (O-2); se non disponibile serve un endpoint con certificato verificabile, non un abbassamento del modo.

### 16.4 SQL injection — CONFORME

Tutte le query passano da SQLAlchemy Core/ORM con parametri legati (prepared statements di asyncpg). Le uniche stringhe `text()` sono costanti (`SELECT 1`, DDL della migrazione). Imposto da test che scandiscono il sorgente (`test_no_string_built_sql`, `test_raw_text_sql_is_constant`).

---

## 17. Segreti e configurazione

### 17.1 Principi

* Tutta la configurazione arriva da variabili d'ambiente con prefisso `NZT_` (`pydantic-settings`, `apps/api/src/app/config.py`); un file `.env` locale è ignorato da git; `apps/api/.env.example` è il modello senza valori reali.
* I segreti sono `SecretStr`: mai presenti in `repr` o nei log (`test_secrets_not_in_repr`). Una variabile vuota significa "usa il default", mai "segreto vuoto".
* **Guardie di produzione** (`NZT_ENVIRONMENT=production`, `test_production_requires_secrets`, `test_production_rejects_missing_signing_key_at_startup`, `test_security_fixes::test_prod_*`): l'avvio fallisce se mancano `ACCESS_TOKEN_PRIVATE_KEY_PEM`, `OAUTH_STATE_KEY`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `STORAGE_ACCESS_KEY_ID`, `STORAGE_SECRET_ACCESS_KEY`; se `LAUNCHER_SHA256` è il default di zeri; se `NZT_DATABASE_URL` o `NZT_REDIS_URL` non sono impostate **esplicitamente** (i default puntano ai servizi di test su `127.0.0.1`); se `sslmode` non è esattamente `verify-full`; se non è impostato `NZT_TRUSTED_PROXY_CIDRS` né l'opt-in `NZT_DIRECT_CLIENT_CONNECTIONS=true` (o se sono impostati entrambi); se API, portale, `STORAGE_PUBLIC_ORIGIN` o `NZT_STORAGE_ENDPOINT_URL` non sono https.
* Perché un opt-in separato per "nessun proxy": una variabile vuota significa sempre "usa il default" (`env_ignore_empty`), quindi `NZT_TRUSTED_PROXY_CIDRS=` non può esprimere una scelta consapevole; dimenticare i CIDR dietro un proxy farebbe condividere a tutti gli utenti l'IP del proxy (limiti per IP globali, audit inutile).
* Le variabili `VITE_*` del portale finiscono nel bundle pubblico: **mai segreti**.

### 17.2 Inventario variabili — API

| Variabile | Segreto | Obbligatoria in prod | Default | Uso |
| :--- | :---: | :---: | :--- | :--- |
| `NZT_ENVIRONMENT` | | sì (`production`) | `development` | Attiva guardie, disattiva docs |
| `NZT_LOG_LEVEL` | | | `INFO` | Livello log |
| `NZT_API_PUBLIC_BASE_URL` | | | `https://api.nztsolutions.it` | `iss`, base `htu`, CSP |
| `NZT_PORTAL_ORIGINS` | | | `https://clienti.nztsolutions.it` | CORS (CSV), CSP, redirect Google di default |
| `NZT_STORAGE_PUBLIC_ORIGIN` | | | `https://storage.nztsolutions.it` | Solo CSP `connect-src` |
| `NZT_DATABASE_URL` | sì | **sì (esplicita)** | DSN di test `nzt_app@127.0.0.1:55432/nzt_test` | Ruolo runtime DML; `postgresql://` convertito in asyncpg; `sslmode` nella URL ignorato |
| `NZT_MIGRATIONS_DATABASE_URL` | sì (solo per Alembic) | **no per l'API** (obbligatoria solo per Alembic) | = `NZT_DATABASE_URL` (fuori prod, solo Alembic) | Ruolo migrator (solo Alembic, passo di pre-deploy); **non** impostarla sul servizio API |
| `NZT_DATABASE_SSLMODE` | | sì (`verify-full`) | `verify-full` in prod, `disable` altrove | TLS asyncpg; in prod solo `verify-full` |
| `NZT_DATABASE_SSL_ROOT_CERT` | | se la CA non è di sistema | — | Path CA |
| `NZT_DATABASE_POOL_SIZE` / `NZT_DATABASE_MAX_OVERFLOW` | | | `10` / `5` | Pool |
| `NZT_REDIS_URL` | sì | **sì (esplicita)** | `redis://127.0.0.1:56379/0` | Limiti, `jti`, marker, `state` OAuth consumati, orologio dei marker |
| `NZT_ACCESS_TOKEN_PRIVATE_KEY_PEM` | **sì** | **sì** | effimera in dev/test | Firma access token Ed25519 |
| `NZT_ACCESS_TOKEN_TTL_SECONDS` | | | `600` (300–600) | TTL access token |
| `NZT_REFRESH_TOKEN_TTL_SECONDS` | | | `604800` (3600–604800) | Scadenza refresh + `Max-Age` |
| `NZT_DPOP_IAT_LEEWAY_SECONDS` | | | `60` (5–300) | Finestra `iat` |
| `NZT_ARGON2_MAX_CONCURRENCY` | | | `2` (1–32) | Argon2 concorrenti |
| `NZT_ARGON2_MAX_QUEUE` | | | `8` (0–1024) | Chiamate Argon2 in attesa; oltre ⇒ `503` + `Retry-After: 1` |
| `NZT_TRUSTED_PROXY_CIDRS` | | **sì** (o l'opt-in sotto) | vuota | Proxy fidati (CSV) |
| `NZT_DIRECT_CLIENT_CONNECTIONS` | | alternativa ai CIDR | `false` | Opt-in esplicito "nessun proxy davanti all'API" (il peer TCP è il client); in prod esclusivo con `NZT_TRUSTED_PROXY_CIDRS` |
| `NZT_MAX_REQUEST_BODY_BYTES` | | | `16384` (1024–1048576) | Limite body |
| `NZT_GOOGLE_CLIENT_ID` | | **sì** | — (Google ⇒ 503) | Client OAuth |
| `NZT_GOOGLE_CLIENT_SECRET` | **sì** | **sì** | — | Client OAuth |
| `NZT_GOOGLE_REDIRECT_URI` | | | `<primo portale>/auth/google/callback` | Da registrare nella console Google |
| `NZT_GOOGLE_AUTHORIZATION_ENDPOINT` / `_TOKEN_ENDPOINT` / `_JWKS_URI` | | | endpoint ufficiali Google | Egress consentito |
| `NZT_GOOGLE_ISSUERS` | | | `https://accounts.google.com,accounts.google.com` | `iss` ammessi |
| `NZT_GOOGLE_HTTP_TIMEOUT_SECONDS` | | | `10` (≤ 30) | Timeout egress |
| `NZT_OAUTH_STATE_KEY` | **sì** | **sì** | effimera in dev/test | AES-256-GCM, base64url di 32 byte |
| `NZT_STORAGE_ENDPOINT_URL` | | sì (default inadatto a R2; **https obbligatorio** in prod) | `https://storage.nztsolutions.it` | Endpoint S3 per la firma |
| `NZT_STORAGE_REGION` | | | `auto` | Regione SigV4 |
| `NZT_STORAGE_BUCKET` | | | `nzt-binaries` | Bucket |
| `NZT_STORAGE_ACCESS_KEY_ID` / `NZT_STORAGE_SECRET_ACCESS_KEY` | **sì** | **sì** | fittizie in dev/test | Credenziali di **sola lettura** sul bucket |
| `NZT_STORAGE_ADDRESSING_STYLE` | | | `path` | `path` / `virtual` |
| `NZT_LAUNCHER_VERSION` | | | `1.0.0` | Chiave oggetto + risposta |
| `NZT_LAUNCHER_SHA256` | | **sì** | 64 zeri (rifiutato in prod) | Hash restituito al client |

### 17.3 Inventario variabili — portale (build time, pubbliche)

| Variabile | Default | Vincolo |
| :--- | :--- | :--- |
| `VITE_API_BASE_URL` | `https://api.nztsolutions.it` | Solo origin, https (http solo loopback); **uguale** a `NZT_API_PUBLIC_BASE_URL`; se cambia, aggiornare `connect-src` in `deploy/_headers`, `deploy/Caddyfile` e nel test CSP |
| `VITE_OAUTH_AUTHORIZE_ORIGINS` | `https://accounts.google.com` | Allow-list CSV degli origin di autorizzazione |

---

## 18. Logging e audit

| Evento | Dove | Contenuto |
| :--- | :--- | :--- |
| Download autorizzato | Tabella `download_logs` (commit prima dell'emissione dell'URL) | `user_id`, `product_code`, `ip_address`, `user_agent` (≤ 512), `download_token_id`, `created_at` |
| Reuse detection | Log applicativo `WARNING` | Testo fisso `SECURITY: refresh token reuse detected; all sessions revoked` (senza ID utente; l'utente si ricava dalle famiglie con `revoked_reason='reuse_detected'`) |
| Redis non disponibile | `ERROR` | Solo il tipo di eccezione |
| Google token endpoint irraggiungibile / scambio rifiutato | `WARNING` / `INFO` | Tipo di eccezione / codice HTTP |
| Eccezione non gestita | `ERROR` con traceback, solo lato server | Metodo e path |
| Chiavi effimere in uso (dev/test) | `WARNING` all'avvio | — |
| Accessi HTTP | Access log di uvicorn | IP del peer (con `--no-proxy-headers` è l'IP del proxy), metodo, path, stato |

Mai registrati: password, token, cookie, body delle richieste, URL prefirmati (il portale non usa `console`, regola lint `no-console`). Lo stato delle sessioni è ricostruibile da `refresh_token_families` (`is_revoked`, `revoked_reason`, `created_at`).

**Lacune (R-8):** nessun log per login falliti, mismatch di chiave DPoP sul refresh, logout, collegamenti Google; nessun log strutturato né alerting; nessuna politica di conservazione per `download_logs` (contiene IP e User-Agent, dati personali).

---

## 19. Modello di sicurezza del client (portale)

| Elemento | Dove vive | Leggibile da JS? | Sopravvive al reload? |
| :--- | :--- | :--- | :--- |
| Access token | Closure di `createTokenStore` | Sì (solo nella scheda) | No |
| Refresh token | Cookie HttpOnly sull'host API | **No** (`document.cookie` è vuoto: E2E 4) | Sì (7 giorni scorrevoli) |
| Chiave privata DPoP | IndexedDB, `extractable=false` | **Non esportabile** (`exportKey` rifiuta: E2E 4); usabile per firmare | Sì, fino al logout o a un refresh `401` |
| Password | Stato del componente, solo nel body POST | — | No |
| `code`/`state` OAuth | URL del callback, rimossi subito | — | No (assenti anche dalla cronologia: E2E 12d) |
| URL prefirmato | Stato del componente, solo in un'ancora | — | No; rimosso alla scadenza |

**Nota sulla minaccia (chiave in IndexedDB).** Uno script XSS in esecuzione nel portale può *usare* la chiave per firmare prove e chiamare l'API finché la pagina è aperta, ma non può *leggerla* né esfiltrarla; il refresh token non è leggibile. Materiale rubato fuori dal dispositivo (cookie, access token) è inutilizzabile senza la chiave. `extractable=false` protegge dal codice JavaScript, **non** da malware locale o da chi copia il profilo del browser: questo scenario è fuori dal modello di minaccia del portale.

**Igiene della chiave:** una chiave creata per un login/registrazione/callback fallito viene eliminata; una chiave il cui refresh riceve `401` viene eliminata (E2E 10f, 11c, 12g); al logout la chiave viene sempre eliminata, così una nuova sessione usa una nuova chiave (sessioni non correlabili per `jkt`).

**Invarianti imposte dal lint** (`apps/portal/eslint.config.js`): `no-console`, `no-eval`, `no-implied-eval`, `no-new-func`, `no-script-url`; divieto di `localStorage`, `sessionStorage`, `document.cookie`, `document.write`, `dangerouslySetInnerHTML`, assegnazioni a `innerHTML`/`outerHTML`.

**Client HTTP** (`src/api/http.ts`): solo path `/api/...` verso `VITE_API_BASE_URL`; `credentials: 'omit'` salvo endpoint `/api/v1/auth/*`; `cache: 'no-store'`, `redirect: 'error'`, `referrerPolicy: 'no-referrer'`, timeout 15 s. Il `detail` del backend serve solo a classificare l'errore e non viene mai mostrato (`errors.test`, E2E 11b); un `401 Invalid DPoP proof` suggerisce di controllare l'orologio del dispositivo (la finestra `iat` è ±60 s).

**Multi-scheda:** `BroadcastChannel('nzt_auth')` trasporta solo `login`/`logout`, mai token.

---

## 20. Supply chain

| Aspetto | Stato |
| :--- | :--- |
| Lockfile JS | `pnpm-lock.yaml` (unico per il workspace); installazione con `pnpm install --frozen-lockfile` |
| Lockfile Python | `apps/api/uv.lock`; installazione con `uv sync --frozen`; Python fissato a 3.12 (`.python-version`) |
| Script di installazione | `pnpm.onlyBuiltDependencies` consente build script solo a `esbuild` e `sharp` |
| Dipendenze runtime del portale | `react`, `react-dom`, `@nzt/ui` (clsx, tailwind-merge, class-variance-authority), font `@fontsource`; nessun router, form library o script di terze parti |
| Dipendenze API | FastAPI, uvicorn, SQLAlchemy, asyncpg, Alembic, pydantic(-settings), email-validator, argon2-cffi, PyJWT[crypto], cryptography, redis, httpx, boto3 |
| CI / audit automatici | **Assenti** nel repository |
| Audit eseguito (revisione indipendente + correzioni) | `pip-audit` su `uv.lock`: nessuna vulnerabilità. `pnpm audit`: prima 26 advisory (3 critical, 8 high, 11 moderate, 4 low); dopo l'aggiornamento di `vitest` a 4.1.12 (solo strumento di test del portale: rimossi `tinypool` e `@vitest/mocker` vulnerabili; `vite` resta 6.4.5, nessun'altra versione cambiata) restano **21** (1 critical, 8 high, 8 moderate, 4 low), **tutte in `apps/landing`** (Astro, sharp, esbuild): aggiornamento della landing da pianificare (rilevante anche per §8.3) |

Comandi di audit raccomandati (non ancora automatizzati):

```bash
pnpm audit --prod                                   # dipendenze JS di produzione
cd apps/api && uv export --frozen --no-dev --format requirements-txt > /tmp/req.txt \
  && uvx pip-audit -r /tmp/req.txt                  # dipendenze Python
```

Raccomandato: job CI che esegue test, lint, i due audit e un aggiornamento controllato delle dipendenze (Dependabot/Renovate).

---

## 21. Differenze rispetto alla specifica originale

| # | Elemento | La specifica diceva | Implementato | Motivo |
| :--- | :--- | :--- | :--- | :--- |
| D1 | Nomi cookie | `__Host-refresh-token`, `__Host-oauth-state` con `Path=/api/v1/auth` | `__Secure-refresh-token`, `__Secure-oauth-state`, stessi attributi, host-only | I browser rifiutano `__Host-` senza `Path=/` (§8.3) |
| D2 | Domini | `https://api.nztsolutions.com`, CSP `https://*.nztsolutions.com` | Default `.it`, tutti configurabili; CSP con origin espliciti | Landing e portale sono `.it`; `SameSite=Strict` richiede API e portale same-site |
| D3 | `download_logs.user_id` | `NOT NULL … ON DELETE SET NULL` | `NULL`-abile, `ON DELETE SET NULL` | Clausole incompatibili; l'audit deve sopravvivere alla cancellazione |
| D4 | Prova DPoP | `htm`, `htu`, `jti`, `iat`, JWK | In più: solo ES256/P-256 con validazione della curva, `typ`, finestra `iat` ±60 s, `jti` monouso in Redis, `ath` obbligatorio sulle risorse; nessun `DPoP-Nonce`; errori sempre `401` | RFC 9449 (`ath` è richiesto dalla RFC per l'accesso alle risorse); difesa da replay e confusione di algoritmo |
| D5 | Access token | RS256 o EdDSA; claim `sub, iss, exp, jti, cnf` | EdDSA (Ed25519); header `typ=at+jwt`, `kid`; claim `iat` e `iat_ms` in più; schema `Authorization` solo `DPoP` | Scelta ammessa; `iat_ms` (ms, orologio Redis) ordina il token rispetto ai marker di revoca senza falsi positivi nello stesso secondo (§9.3) |
| D6 | Reuse detection | Revoca della famiglia e "invalida ogni sessione attiva" | Revoca di **tutte** le famiglie dell'utente + marker Redis `user_revoked_after_ms` | Rendere effettiva l'invalidazione anche degli access token già emessi (effetto collaterale R-21) |
| D7 | Logout | Solo citato (§10) | Contratto definito: cookie + DPoP, `204`, idempotente, marker `jkt_revoked_after_ms` | Lacuna della specifica |
| D8 | Concorrenza server | Non specificata | Rotazione atomica; il perdente di una corsa è trattato come riuso; scadenza ≠ riuso; mismatch di chiave non consuma il token | Nessuna finestra di grazia nella specifica |
| D9 | Web Locks | Solo per il refresh | Stesso lock per tutte le operazioni sul cookie, lock separato per la chiave, `keepalive`, `BroadcastChannel` | Corse trovate in test ed E2E (§10) |
| D10 | Chiave DPoP | Generata nel browser (implicitamente per sessione) | Persistita in IndexedDB, non estraibile, una per profilo | Senza persistenza un reload renderebbe orfana la sessione legata al `jkt` |
| D11 | Rate limiting | Middleware; login, registrazione, refresh, download | Dependency FastAPI, stessi valori, non configurabili; fallback `anon:<ip>` sul refresh; **in più** Google authorize 20/min e callback 10/min per IP | Le chiavi richiedono identità già interpretate; gli endpoint Google generano egress e cookie |
| D12 | Indisponibilità Redis | Non specificata | Fail-closed `503` | Mai endpoint illimitati o riproducibili |
| D13 | Politica password | ≥ 12, speciali, numeri | In più: almeno una lettera, massimo 128 | Evitare password solo numeriche/simboli; limitare l'input |
| D14 | Timing | Dummy verify se l'utente non esiste | Anche per utenti solo-Google e disattivati | Stati indistinguibili |
| D15 | Registrazione email esistente | Non specificata | `400 Registration failed` generico | Nessun messaggio "email già registrata" |
| D16 | Google authorize | "Output: URL di redirect" | JSON `{"authorization_url": …}` | La SPA naviga dopo che il cookie di state è stato impostato via `fetch` |
| D17 | Cookie di state OAuth | Contiene lo `state`, cifrato | AES-256-GCM con `state`, `code_verifier`, `nonce`, `exp`; in più `state` monouso registrato in Redis al callback | PKCE e nonce senza storage di sessione; il replay del cookie non raggiunge più Google |
| D18 | OIDC | PKCE, `state` | In più: `nonce`, `email_verified` obbligatorio, `409` per altro `sub`, `403` account disattivato, `503` se non configurato | Hardening OIDC |
| D19 | Header HTTP | Insieme della §9.1 | Identico + `Cache-Control: no-store`; il portale ha una CSP propria più restrittiva con Trusted Types | Token e URL non devono essere memorizzati in cache |
| D20 | TLS DB | `sslmode=verify-full` | Produzione: solo `verify-full` (CONFORME; `verify-ca` non più accettato) | — |
| D21 | Edge proxy | WAF, rate limiting L4/L7, TLS 1.3 | Nessun componente edge nel repository; TLS dall'edge Railway; rate limit applicativi | Fuori dal codice (O-1); **NON VERIFICATO** |
| D22 | Egress confinato | Egress HTTPS confinato a Google e storage | Confinamento solo applicativo (URL da configurazione, nessun redirect); nessuna policy di rete; nessun egress verso lo storage (firma locale) | Railway non configurato nel repository |
| D23 | Verifica integrità binario | Il client o l'interfaccia valida lo SHA-256 | Il portale mostra hash e istruzioni; nessuna verifica automatica | Il Launcher non è nel repository |
| D24 | Python / client S3 | 3.11+, `aioboto3` o client REST | 3.12, `boto3` solo per firma locale | Nessuna I/O di rete da rendere asincrona |
| D25 | Infrastruttura di test | testcontainers o docker-compose | `docker-compose.test.yml` + `scripts/test-services.sh` nativo | Il compose non è stato avviato nella sandbox (nessun Docker) |
| D26 | Aggiunte di robustezza | — | `is_active` ricontrollato a ogni richiesta; limite body 16 KiB; 422 sanificati; docs disattivate in prod; `/healthz`; guardie di avvio in produzione (anche DSN/Redis espliciti, proxy fidati o opt-in, storage https); rehash trasparente; coda Argon2 limitata con `503` + `Retry-After`; CORS su tutti gli errori ed esposizione di `Retry-After` | Hardening (incluse le correzioni della revisione indipendente) |

---

## 22. Evidenze di verifica

### 22.1 Backend (`apps/api`) — contro PostgreSQL 16 e Redis 7 reali (nessun mock per DB e Redis)

| Controllo | Risultato |
| :--- | :--- |
| `uv run pytest -q` | **153 passed** (110 preesistenti, di cui 4 aggiornati per contratto cambiato intenzionalmente, + 43 di regressione in `test_security_fixes.py`, ognuno dei quali — salvo i controlli di non-regressione indicati nella relazione delle correzioni — fallisce sul codice precedente) |
| `ruff check` / `ruff format --check` | Nessun problema / 41 file formattati |
| `mypy` strict su `src/app` | Nessun errore (27 file) |
| `alembic upgrade head` / `check` / `downgrade base` / `upgrade head` | OK, `No new upgrade operations detected.` |
| Avvio uvicorn + `GET /healthz` | `200 {"status":"ok"}` con tutti gli header della §13.1 |
| `docker compose -f docker-compose.test.yml config` | Valido; lo stack compose **non** è stato avviato (nessun daemon Docker) |

| File di test | Test | Ambito |
| :--- | ---: | :--- |
| `test_dpop.py` | 25 | Prova DPoP, confusione di algoritmo, `ath`, replay, autenticazione delle risorse |
| `test_auth_flows.py` | 17 | Register/login/refresh/logout, attributi cookie, RTR, reuse, concorrenza |
| `test_http_hardening.py` | 16 | Header su ogni risposta, CORS, docs, limite body, errori senza eco |
| `test_google.py` | 13 | Authorize, state, PKCE, nonce, ID token, collegamento account |
| `test_ratelimit.py` | 12 | Ogni limite, finestra scorrevole, fail-closed, IP e proxy fidati |
| `test_openapi_config.py` | 10 | Contratti §8, configurazione, guardie di produzione, Argon2id, politica password |
| `test_downloads.py` | 9 | Entitlement, audit, catalogo lato server, presign |
| `test_db.py` | 8 | Migrazioni, schema, ruoli, assenza di SQL costruito con stringhe |
| `test_security_fixes.py` | 43 | Regressioni della revisione indipendente: M1/I2 (X-Forwarded-For), L2 (tipi dei claim), L3 (marker al ms), L4 (coda Argon2), L6 (limiti Google, state monouso), I3, I5, I6, guardie di produzione |
| **Totale** | **153** | |

Misure dal vivo (uvicorn, `NZT_TRUSTED_PROXY_CIDRS=127.0.0.1/32`, 100 login fasulli in parallelo da 100 IP distinti, `NZT_ARGON2_MAX_CONCURRENCY=2`): prima della correzione un login legittimo impiegava 1,5–6,3 s (coda illimitata, login fasulli fino a 6,5 s); dopo, il login legittimo durante il picco riceve in 0,2–0,8 s un `503` con `Retry-After: 1` e, ripetuto dopo l'attesa indicata, riesce in 1,4–1,9 s totali; i login fasulli eccedenti sono scartati in ≤ 1,6 s. Registrazioni con 32 hop `X-Forwarded-For` falsificati: prima 8/8 accettate, dopo `201, 201, 201, 429…`. Prova DPoP con `iat: NaN`: prima `500`, dopo `401`.

### 22.2 Portale (`apps/portal`) — Vitest con WebCrypto reale

**110 test in 12 file** (Vitest 4.1.12), tutti superati: errors 24, passwordPolicy 30, session 14, contrast 8, dpop 7, csp 7, keyManager 4, thumbprint 4, tokenStore 4, oauthCallback 3, safeUrls 3, locks 2. ESLint, `tsc` strict e Prettier senza problemi su portal, ui e landing.

### 22.3 End-to-end nel browser reale

**66/66 controlli superati** in Chromium (Playwright) contro backend uvicorn reale, PostgreSQL 16, Redis 7, portale servito da `vite preview` con gli header di produzione e un IdP Google **simulato** (che applica PKCE S256 e credenziali client); 0 violazioni CSP/Trusted Types, 0 errori console inattesi. Rispetto alla versione precedente (65 controlli) il controllo 14b è stato invertito di proposito (ora `Retry-After` è leggibile) ed è stato aggiunto il 14c (il messaggio di 429 mostra l'attesa reale in secondi/minuti, uguale all'header).

Scenari: (1) rotta protetta senza sessione, 0 chiamate API, header CSP e noindex; (2) accessibilità dei form; (3) validazione password lato client; (4) registrazione: DPoP 201, web storage vuoto, `document.cookie` vuoto, chiave P-256 non estraibile, `dpop_jkt` = thumbprint del browser, attributi del cookie; (5) download: 403 senza entitlement, poi URL prefirmato + 1 riga di audit; (6) reload: un solo refresh 200; (7) marker `jkt` ⇒ `401, refresh 200, 200`; (8) due schede e reload concorrenti, 8f navigazioni che interrompono il refresh; (9) cookie rubato con chiave dell'attaccante ⇒ 401, sessione legittima intatta; (10) logout completo e replay del cookie ⇒ 401; (11) password errata: messaggio generico, nessuna chiave residua; (12) Google: callback pulito, account locale non verificato ⇒ 403, `access_denied`; (13) 404; (14) `401×5, 429`, messaggio "Riprova tra N secondi" con N = `Retry-After`; (15) riduzione movimento; (16) mobile 390 px.

Ambiente E2E: API `http://localhost:18080`, portale `http://localhost:4173`, IdP finto `http://localhost:18090` (l'esecuzione delle correzioni ha usato porte isolate 18380/4373/18390 con PostgreSQL 55732 e Redis 56679); hostname `localhost` affinché Chromium accetti i cookie `Secure` su http e le due origini risultino same-site. **TLS non è stato quindi esercitato.**

**Dove vive l'harness E2E:** `services.sh`, `fake_idp.py`, `portal-e2e.cjs` si trovano **solo nello scratchpad di sessione dell'agente che ha sviluppato il sistema, fuori dal repository e non persistente**. Non sono versionati né eseguiti in CI (O-P8): oggi gli E2E non sono riproducibili da un checkout del repository.

### 22.4 Landing

Build della landing prima e dopo l'estrazione di `packages/ui`: **25 file su 25 identici** (sha256 dei file di `dist/`, esclusi `sitemap-0.xml` e `sitemap-index.xml`, che differiscono solo per `<lastmod>`). Stesso risultato prima e dopo le correzioni della revisione (inclusa la modifica del lockfile per `vitest`).

### 22.5 Non verificato

Google reale, download reale da R2 con l'URL generato, rete/TLS/proxy di Railway, stack `docker-compose.test.yml`, comportamento su browser non Chromium (Trusted Types è solo Chromium; Web Locks e `keepalive` sono verificati solo in Chromium), prove di carico.

---

## 23. Rischi residui e punti aperti

Ordinati per priorità. "O-…" sono i punti aperti delle relazioni di implementazione.

| # | Priorità | Rischio / punto aperto | Effetto | Azione proposta |
| :--- | :--- | :--- | :--- | :--- |
| R-1 | Alta | **XSS nel portale** | Lo script può usare chiave e sessione finché la pagina è aperta (non esfiltrarle) | Mantenere CSP/Trusted Types, nessuno script di terze parti, revisione delle dipendenze |
| R-2 | Alta | **Nessuna verifica email né reset password** (O-5, O-P5, O-P6; revisione indipendente **M2**, non corretta: decisione utente) | Account locali mai verificati: login con email altrui possibile; un pre-registratore blocca l'accesso Google della vittima e, se lo staff concede una licenza cercando l'email, la riceve lui | Implementare verifica email e reset; quando arriva un'identità Google verificata per un account locale non verificato, neutralizzare la credenziale locale; fino ad allora non concedere entitlement a account locali senza verifica manuale dell'identità |
| R-3 | Alta | **Deploy non definito** (O-1, O-2, O-4): Dockerfile, servizi Railway, CIDR proxy, TLS DB su rete privata, esposizione pubblica di Postgres/Redis | Configurazioni errate possono annullare limiti per IP, audit, isolamento della rete | Seguire la checklist §24.6; verificare il peer reale dell'edge |
| R-4 | Alta (disponibilità) | **Finestra reload-durante-refresh** (O-P1) | Raro falso positivo di reuse ⇒ revoca di tutte le sessioni dell'utente | **Decisione utente pendente:** regola di grazia nel backend (riuso con la chiave della famiglia entro pochi secondi = benigno) |
| R-5 | Media | Nessuna durata assoluta della sessione (O-6) | Una sessione usata almeno una volta a settimana dura indefinitamente | Durata massima della famiglia (es. 30 giorni) |
| R-6 | Media | Rotazione della chiave di firma: un solo `kid` (O-6) | La rotazione invalida tutti gli access token (il portale recupera con un refresh) | Supporto a più chiavi di verifica / JWKS interno |
| R-7 | Media | Launcher non firmato (O-8); hash solo mostrato | Manomissione non rilevata se l'utente non verifica | Firma Authenticode; pubblicare l'hash reale |
| R-8 | Media | Logging di sicurezza minimo, nessun alerting, nessuna conservazione definita per `download_logs` | Indagini difficili; dati personali senza scadenza | Log strutturati (login falliti, mismatch, logout, reuse con ID utente), alert su reuse, politica di retention |
| R-9 | Media | Nessun rate limit sul logout (O-9); nessun WAF; nessun limite globale (solo per IP/email/utente) | Superficie DoS residua (i limiti Google per IP e la coda Argon2 limitata sono ora presenti) | WAF/limiti all'edge (es. Cloudflare davanti a Railway) |
| R-10 | Media | Blocco mirato del login (5/min per email) | Un attaccante può impedire il login di una vittima nota | Valutare limiti progressivi o CAPTCHA dopo soglia |
| R-11 | Media | Nessuna CI; E2E fuori dal repository (O-P8) | Regressioni di sicurezza non intercettate | Pipeline con test backend/portale, E2E Playwright, audit dipendenze |
| R-12 | Media | Nessun provisioning degli entitlement (O-7) | Concessioni via SQL manuale, soggette a errori | Strumento amministrativo con audit |
| R-13 | — | ~~`Retry-After` non esposto via CORS (O-P2)~~ **Risolto** | Il portale mostra l'attesa reale | — |
| R-14 | Bassa | Nessun endpoint `/me` (O-P4) | La dashboard non mostra l'email | Aggiungere `GET /api/v1/me` protetto da DPoP |
| R-15 | Bassa | `code` OAuth nei log di accesso dell'hosting statico | Codice monouso, legato a PKCE e allo state di 5 min | Accettato |
| R-16 | Bassa | Orologio del dispositivo fuori di ±60 s | Login impossibile (messaggio dedicato) | Eventuale `DPoP-Nonce` |
| R-17 | Bassa | Browser senza Web Locks o senza IndexedDB | Possibili logout spuri / nessuna sessione al reload | Accettato (browser evergreen supportati) |
| R-18 | Bassa (Media se la landing resta vulnerabile) | Cookie tossing da sottodominio fratello (revisione **L5**, non corretta: decisione utente) | Login CSRF via cookie di state OAuth e logout forzato (§8.3); nessuna session fixation | Decidere tra `__Host-` con `Path=/`, rifiuto dei cookie duplicati, state legato al `jkt`; nel frattempo nessun contenuto di terzi su `*.nztsolutions.it` e landing aggiornata |
| R-19 | — | ~~Guardie di produzione incomplete~~ **Risolto**: DSN, Redis URL, proxy fidati (o opt-in), storage https e `verify-full` sono ora obbligatori | — | — |
| R-21 | Bassa | **Replay di un refresh token storico** (revisione **L1**, non corretta: decisione utente) | Un valore già usato, anche scaduto, ripresentato con qualunque chiave revoca tutte le sessioni della vittima, all'infinito (§9.2) | Classificare `expires_at ≤ now()` prima di `is_used`; eliminare le righe usate/scadute; valutare revoca della sola famiglia + alert |
| R-22 | Info | Enumerazione via registrazione (revisione **I1**, non corretta: richiede verifica email) | `201` vs `400 Registration failed` rivela se un'email esiste (3/h per IP) | Con la verifica email: risposta sempre `202` e invio di una mail |
| R-23 | Info | Privilegi del ruolo applicativo (revisione **I4**, non corretta: decisione utente) | `nzt_app` può `UPDATE`/`DELETE` su `download_logs` e `UPDATE` su `alembic_version`: l'audit non è append-only per l'applicazione | Migrazione: `REVOKE UPDATE, DELETE ON download_logs FROM nzt_app; REVOKE ALL ON alembic_version FROM nzt_app;` |
| R-20 | Bassa | Branding del pulsante Google monocromatico (O-P7) | Possibile non conformità alle linee guida Google | Conferma utente |

Gli endpoint e i flussi non sono stati validati con Google, R2 e Railway reali (§22.5).

---

## 24. Runbook operativo

### 24.1 Avvio dell'API

```bash
# migrazioni (passo separato, ruolo migrator)
cd apps/api && NZT_MIGRATIONS_DATABASE_URL=... uv run alembic upgrade head

# processo applicativo (ruolo nzt_app)
uvicorn app.main:create_app --factory --no-proxy-headers --host 0.0.0.0 --port $PORT
```

`--no-proxy-headers` è **obbligatorio** (§15). Facoltativo: `--no-server-header` per non esporre `server: uvicorn` (raccomandazione, non verificata nel progetto).

### 24.2 Database

```bash
psql -v ON_ERROR_STOP=1 -v db_name=nzt -v migrator_password='<segreto>' -v app_password='<segreto>' \
     -f apps/api/scripts/db/roles.sql          # una sola volta, come superuser/admin
```

Poi impostare `NZT_DATABASE_URL` (utente `nzt_app`) e `NZT_MIGRATIONS_DATABASE_URL` (utente `nzt_migrator`) e configurare TLS `verify-full` con CA (`NZT_DATABASE_SSL_ROOT_CERT` se la CA non è di sistema; in produzione non sono accettati altri modi).

### 24.3 Generazione delle chiavi

```bash
openssl genpkey -algorithm ed25519                     # NZT_ACCESS_TOKEN_PRIVATE_KEY_PEM (PEM PKCS#8)
python -c "import secrets,base64;print(base64.urlsafe_b64encode(secrets.token_bytes(32)).decode().rstrip('='))"
                                                       # NZT_OAUTH_STATE_KEY
openssl rand -base64 32                                # password dei ruoli DB e di Redis
sha256sum NZT-Launcher.exe                             # NZT_LAUNCHER_SHA256 (64 hex minuscoli)
```

Rotazione: nuova `ACCESS_TOKEN_PRIVATE_KEY_PEM` ⇒ tutti gli access token in circolazione diventano `401`, il portale fa refresh e ritenta (i refresh token sono opachi e restano validi). Nuova `OAUTH_STATE_KEY` ⇒ i login Google in corso (≤ 5 min) falliscono con `400`. Credenziali storage: nessun impatto sugli utenti oltre gli URL già emessi.

### 24.4 Configurazione Railway (da fare, **NON VERIFICATO**)

1. Domini personalizzati `nztsolutions.it`, `clienti.nztsolutions.it`, `api.nztsolutions.it` (non i domini generati, §3.1).
2. PostgreSQL e Redis raggiungibili **solo** dalla rete privata: disattivare eventuali proxy TCP pubblici.
3. `NZT_TRUSTED_PROXY_CIDRS` = range da cui l'edge Railway si connette al container, verificato osservando il peer reale (obbligatorio in produzione; solo se l'API è esposta senza proxy usare invece `NZT_DIRECT_CLIENT_CONNECTIONS=true`).
4. Servizio statico del portale che emetta gli header di `deploy/Caddyfile` (es. container Caddy) con fallback SPA; build con `VITE_API_BASE_URL=https://api.nztsolutions.it`.
5. Migrazioni come comando di pre-deploy con l'URL del migrator; il servizio API non deve ricevere `NZT_MIGRATIONS_DATABASE_URL`.
6. Variabili segrete solo come variabili di servizio Railway, mai nel repository.

### 24.5 Risposta a incidenti

**Che cosa fa da sola la reuse detection.** Se un refresh token già consumato viene ripresentato (furto del cookie o corsa client), l'API revoca tutte le famiglie dell'utente (`revoked_reason='reuse_detected'`), imposta `user_revoked_after_ms:{user_id}` (gli access token emessi smettono di funzionare entro la richiesta successiva), cancella il cookie e registra il warning `SECURITY: refresh token reuse detected`. L'utente deve rifare il login su ogni dispositivo.

Individuare gli eventi recenti:

```sql
SELECT user_id, count(*), max(created_at) FROM refresh_token_families
WHERE revoked_reason = 'reuse_detected' GROUP BY user_id ORDER BY 3 DESC;
```

**Disconnettere tutte le sessioni di un utente (sospetto furto).** Non esiste un endpoint amministrativo; con un ruolo amministrativo:

```sql
UPDATE refresh_token_families SET is_revoked = TRUE, revoked_reason = 'admin_revoked'
WHERE user_id = '<uuid>' AND is_revoked = FALSE;
```
```bash
redis-cli SET user_revoked_after_ms:<uuid> "$(( $(date +%s) * 1000 + 999 ))" EX 605   # ms; TTL = TTL access token + 5 s
```

**Bloccare un utente:** `UPDATE users SET is_active = FALSE WHERE id = '<uuid>';` — effetto immediato: ogni richiesta protetta rilegge `is_active`, la rotazione fallisce, il login risponde con l'errore generico, Google risponde `403 Account is disabled`. Riattivando l'utente le famiglie revocate restano revocate.

**Sospetta compromissione di una chiave server:** firma access token ⇒ rotazione (§24.3); chiave state OAuth ⇒ rotazione; credenziali storage ⇒ revoca del token R2 e nuova coppia; DB/Redis ⇒ cambio password e riavvio.

### 24.6 Checklist prima del go-live

- [ ] `NZT_ENVIRONMENT=production` (le guardie di avvio diventano attive, `/docs` e `/openapi.json` spariscono).
- [ ] Chiavi reali per firma token e state OAuth; credenziali Google con redirect URI `https://clienti.nztsolutions.it/auth/google/callback` registrato.
- [ ] `NZT_DATABASE_URL`, `NZT_REDIS_URL` impostate (ora imposte dalle guardie); `NZT_MIGRATIONS_DATABASE_URL` solo nel passo di migrazione, non sul servizio API; `roles.sql` eseguito; TLS DB `verify-full` verificato.
- [ ] `NZT_TRUSTED_PROXY_CIDRS` impostato (imposto dalle guardie, salvo opt-in `NZT_DIRECT_CLIENT_CONNECTIONS=true`) e verificato (un login da IP noto deve comparire con quell'IP in `download_logs` dopo un download di prova).
- [ ] `NZT_STORAGE_ENDPOINT_URL` sull'host S3 di R2; credenziali di sola lettura limitate al bucket; bucket non pubblico; `NZT_LAUNCHER_VERSION` e `NZT_LAUNCHER_SHA256` reali; download di prova completato e hash verificato.
- [ ] `VITE_API_BASE_URL` = `NZT_API_PUBLIC_BASE_URL`; header del portale presenti come header HTTP (CSP, `X-Robots-Tag`, `frame-ancestors`).
- [ ] Postgres e Redis non raggiungibili da Internet.
- [ ] Uvicorn avviato con `--no-proxy-headers`.
- [ ] Test backend (153) e portale (110) verdi sul commit da rilasciare; `pnpm audit --prod` e `pip-audit` senza vulnerabilità aperte.
- [ ] Prova manuale end-to-end in produzione: registrazione, login, reload, Google, download, logout.
- [ ] Decisione presa su O-P1 (finestra di grazia), verifica email (R-2/M2), replay di token storici (R-21/L1), cookie tossing (R-18/L5), privilegi su `download_logs` (R-23/I4).

---

## Appendice A — Endpoint dell'API

Tutte le risposte d'errore hanno body `{"detail": …}` e, per gli origin del portale, gli header CORS (incluso `Access-Control-Expose-Headers: Retry-After`). Valgono per ogni endpoint: `413` (body > 16 KiB), `500` generico, `503 Service temporarily unavailable` + `Retry-After: 5` se Redis non risponde sugli endpoint che lo usano; register/login: `503 Service busy, please retry shortly` + `Retry-After: 1` se la coda Argon2 è piena. Le risposte con `401` DPoP portano `WWW-Authenticate` (§7.4).

| Metodo e path | Autenticazione | Rate limit | Successo | Errori |
| :--- | :--- | :--- | :--- | :--- |
| `POST /api/v1/auth/register` body `{email,password}` | Prova DPoP (senza `ath`) | 3/h per IP | `201` `{access_token, token_type:"DPoP", expires_in}` + cookie refresh | `400 Registration failed`; `401 Invalid DPoP proof`; `422` (email/politica); `429` |
| `POST /api/v1/auth/login` body `{email,password}` | Prova DPoP | 5/min per IP + 5/min per email | `200` token + cookie refresh | `401 Invalid email or password`; `401 Invalid DPoP proof`; `422`; `429` |
| `POST /api/v1/auth/refresh` (cookie) | Prova DPoP con chiave della famiglia | 30/min per famiglia (`anon:<ip>` se sconosciuta) | `200` token + cookie ruotato | `401 Missing refresh token`; `401 Invalid refresh token` (+ cookie cancellato); `401 Refresh token reuse detected` (+ revoca totale, cookie cancellato); `401 DPoP key does not match refresh token binding`; `401 Invalid DPoP proof`; `429` |
| `POST /api/v1/auth/logout` (cookie) | Prova DPoP con chiave della famiglia | nessuno | `204` + cookie cancellato (anche per token sconosciuto) | `401 Missing refresh token`; `401 Invalid DPoP proof` (prova non valida o chiave diversa) |
| `GET /api/v1/auth/google/authorize` | Nessuna (CORS: solo portale) | 20/min per IP | `200 {authorization_url}` + cookie `__Secure-oauth-state` | `429`; `503 Google sign-in not configured` |
| `POST /api/v1/auth/google/callback` body `{code,state}` (cookie state) | Prova DPoP | 10/min per IP | `200` token + cookie refresh, cookie state cancellato | `400 Invalid OAuth state` / `OAuth state expired` / `OAuth state already used` / `Authorization code exchange failed` / errori ID token / `Google account email is not verified`; `401 Invalid DPoP proof`; `403 Account is disabled` / account locale non verificato; `409` altro `sub` o conflitto; `502` IdP non raggiungibile; `503` non configurato |
| `GET /api/v1/downloads/launcher` | `Authorization: DPoP <AT>` + prova con `ath` | 10/h per utente | `200 {download_url, sha256, version, expires_in:300}` | `401 Not authenticated` / `Invalid access token` / `Invalid DPoP proof`; `403 User does not have active entitlement for launcher_core`; `429` |
| `GET /healthz` | Nessuna | nessuno | `200 {"status":"ok"}` | `503 {"detail":"unavailable"}` |
| `GET /docs`, `GET /openapi.json` | Nessuna | nessuno | Solo fuori produzione | `404` in produzione |

## Appendice B — Mappa file → responsabilità di sicurezza

| File | Responsabilità |
| :--- | :--- |
| `apps/api/src/app/config.py` | Configurazione, segreti `SecretStr`, guardie di produzione |
| `apps/api/src/app/security/dpop.py` | Validazione prove DPoP, anti-replay |
| `apps/api/src/app/security/tokens.py` | Access token EdDSA, generazione e hash dei refresh token |
| `apps/api/src/app/security/passwords.py` | Argon2id, semaforo, coda limitata (`503`), dummy verify, politica password |
| `apps/api/src/app/security/sealed.py` | AES-256-GCM del cookie di state OAuth |
| `apps/api/src/app/security/jose_utils.py` | base64url stretto, thumbprint RFC 7638 |
| `apps/api/src/app/services/sessions.py` | Famiglie, RTR atomica, reuse detection, logout, marker |
| `apps/api/src/app/services/google.py` | OIDC: URL di autorizzazione, scambio codice, verifica ID token, cache JWKS |
| `apps/api/src/app/services/storage.py` | Catalogo prodotti, presign SigV4 |
| `apps/api/src/app/deps.py` | Autenticazione delle risorse, `require_entitlement` |
| `apps/api/src/app/routers/*.py` | Endpoint e ordine dei controlli |
| `apps/api/src/app/cookies.py` | Rendering esatto dei cookie |
| `apps/api/src/app/client_ip.py` | IP client e proxy fidati |
| `apps/api/src/app/ratelimit.py` | Sliding window Redis, fail-closed |
| `apps/api/src/app/middleware.py` | Header di sicurezza, guardia errori (dentro e fuori CORS), limite body |
| `apps/api/src/app/errors.py` | Handler 422/429/503, `WWW-Authenticate` |
| `apps/api/src/app/main.py` | Factory, CORS, ordine dei middleware |
| `apps/api/scripts/db/roles.sql` | Ruoli a privilegio minimo |
| `apps/portal/src/auth/*` | Chiave DPoP, prove, token in memoria, orchestrazione sessione |
| `apps/portal/src/api/http.ts` | Client API, DPoP, `keepalive`, nessun log |
| `apps/portal/src/lib/{locks,safeUrls,oauthCallback,passwordPolicy}.ts` | Web Locks, validazione URL, pulizia callback, politica password |
| `apps/portal/csp.config.ts`, `apps/portal/deploy/*` | CSP e header del portale |
| `apps/portal/eslint.config.js` | Invarianti di sicurezza imposte dal lint |
