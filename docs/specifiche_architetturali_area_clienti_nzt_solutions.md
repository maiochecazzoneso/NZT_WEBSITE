# NZT SOLUTIONS — AREA CLIENTI: SPECIFICHE ARCHITETTURALI E DI SICUREZZA

Questo documento costituisce la specifica tecnica esaustiva per lo sviluppo dell'Area Clienti della piattaforma **NZT Solutions**. Tutte le implementazioni software devono conformarsi rigorosamente ai requisiti crittografici, architetturali e di sicurezza qui descritti.

---

## 1. VISIONE D'INSIEME E STACK TECNOLOGICO

* **Backend:** FastAPI (Python 3.11+) asincrono (`asyncio`, `asyncpg`, `SQLAlchemy 2.0+` o `SQLModel`).
* **Database Relazionale:** PostgreSQL 16+ (infrastruttura di rete isolata).
* **Caching & Rate Limiting:** Redis 7+ (in-memory, isolato).
* **Frontend:** Web Application moderna (Astro/React/Next/Svelte) con storage di token unicamente in memoria RAM e Web Crypto API.
* **Storage Binari Launcher:** Private Object Storage (S3-compatible: Cloudflare R2 / AWS S3) protetto da Presigned URLs effimeri.
* **Modello di Autenticazione:** Ibrido OIDC/Locale con **DPoP (RFC 9449)**, **Refresh Token Rotation (RTR)** e **Opaque Cookie Storage**.

---

## 2. TOPOLOGIA DI RETE E PERIMETRO DI SICUREZZA

```
[ Client Browser ]
        │  HTTPS (TLS 1.3) + Header DPoP + Cookie __Host-refresh-token
        ▼
[ Edge Proxy / Reverse Proxy (Cloudflare / Nginx / Traefik) ]
        │  WAF, Rate Limiting L4/L7, TLS Termination, Header HTTP Injection
        ▼
[ Backend API (FastAPI Container) ]
   ├── Rete Privata Interna (VPC / Docker Bridge) ──► [ PostgreSQL 16 ] (Porta 5432 non esposta su 0.0.0.0)
   ├── Rete Privata Interna (VPC / Docker Bridge) ──► [ Redis 7 ]       (Porta 6379 non esposta su 0.0.0.0)
   └── Egress HTTPS Confinato ──────────────────────► [ Google Identity API ] & [ Object Storage R2/S3 ]
```

### Regole Fondamentali di Isolamento
1. **Database Blindato:** L'istanza PostgreSQL non deve possedere alcun binding su interfacce pubbliche. L'accesso è consentito unicamente tramite connessioni interne autenticate con TLS (`sslmode=verify-full`).
2. **Principio del Privilegio Minimo (Least Privilege):** L'utente applicativo del DB non deve essere `postgres` né possedere diritti DDL/Superuser. Deve disporre solo dei permessi `SELECT`, `INSERT`, `UPDATE`, `DELETE` sullo schema `public`. Le migrazioni DDL vengono eseguite da pipeline separate.
3. **Prepared Statements Obbligatori:** Prevenzione totale di SQL Injection delegata a SQLAlchemy/asyncpg tramite prepared statements parametrizzati al 100%. È tassativamente vietata la formattazione diretta o l'interpolazione di stringhe nelle query.

---

## 3. MODELLO DATI RELAZIONALE (POSTGRESQL)

```sql
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 1. Tabella Utenti Core
CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    email VARCHAR(255) NOT NULL,
    password_hash VARCHAR(255) NULL, -- NULL se l'utente accede solo via OAuth Google
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    is_verified BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX idx_users_email_lower ON users (LOWER(email));

-- 2. Identità di Autenticazione (Multi-provider)
CREATE TABLE auth_identities (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    provider VARCHAR(32) NOT NULL, -- 'local', 'google'
    provider_user_id VARCHAR(255) NOT NULL, -- Google 'sub' per Google, email normalizzata per 'local'
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(provider, provider_user_id)
);
CREATE INDEX idx_identities_user_id ON auth_identities(user_id);

-- 3. Famiglie di Refresh Token (RTR & Token Reuse Detection)
CREATE TABLE refresh_token_families (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    dpop_jkt VARCHAR(255) NOT NULL, -- Thumbprint SHA-256 della chiave pubblica del browser
    is_revoked BOOLEAN NOT NULL DEFAULT FALSE,
    revoked_reason VARCHAR(100) NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_families_user ON refresh_token_families(user_id);

-- 4. Refresh Token Istanziati
CREATE TABLE refresh_tokens (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    family_id UUID NOT NULL REFERENCES refresh_token_families(id) ON DELETE CASCADE,
    token_hash VARCHAR(64) NOT NULL UNIQUE, -- SHA-256 del raw refresh token
    is_used BOOLEAN NOT NULL DEFAULT FALSE,
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_refresh_token_lookup ON refresh_tokens(token_hash);

-- 5. Diritti Prodotti e Licenze (Launcher & Software)
CREATE TABLE entitlements (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    product_code VARCHAR(64) NOT NULL, -- 'launcher_core', 'nzt_suite'
    is_enabled BOOLEAN NOT NULL DEFAULT TRUE,
    valid_until TIMESTAMPTZ NULL, -- NULL = licenza a vita
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(user_id, product_code)
);
CREATE INDEX idx_entitlements_lookup ON entitlements(user_id, product_code, is_enabled);

-- 6. Audit Log Download e Sicurezza
CREATE TABLE download_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE SET NULL,
    product_code VARCHAR(64) NOT NULL,
    ip_address INET NOT NULL,
    user_agent TEXT NULL,
    download_token_id VARCHAR(64) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_download_audit ON download_logs(user_id, created_at DESC);
```

---

## 4. CRITTOGRAFIA E AUTENTICAZIONE LOCALE

### 4.1. Hashing delle Password (Argon2id)
L'agente deve configurare l'algoritmo **Argon2id** (conforme alle raccomandazioni OWASP Password Storage):
* **Memory Cost ($m$):** 65536 KiB (64 MiB).
* **Time Cost ($t$):** 3 iterazioni.
* **Parallelism Factor ($p$):** 4 thread paralleli.
* **Hash & Salt Length:** Salt 16 byte crittograficamente sicuro (`os.urandom(16)`), output hash 32 byte.

### 4.2. Prevenzione dei Timing Attacks
Nel flusso di login, il backend non deve permettere a un attaccante di distinguere tra "utente non registrato" e "password non valida" tramite la misurazione dei tempi di risposta:
* Se la query su `users` restituisce zero risultati, il sistema **deve comunque eseguire** un ciclo computazionale dummy di `argon2id.verify` contro un hash fittizio prima di restituire `401 Unauthorized`.

---

## 5. INTEGRAZIONE GOOGLE OAUTH 2.0 / OIDC

### 5.1. Flusso di Autorizzazione
* **Protocollo:** Authorization Code Flow con **PKCE** (Proof Key for Code Exchange – RFC 7636) obbligatorio.
* **Parametri:** `code_challenge_method=S256`.

### 5.2. Mitigazione CSRF su OAuth
1. Il backend genera un token casuale ad alta entropia (`secrets.token_urlsafe(32)`) come `state`.
2. Lo `state` viene scritto all'interno di un cookie transitorio cifrato:
   * Nome: `__Host-oauth-state`
   * Attributi: `HttpOnly=True`, `Secure=True`, `SameSite=Lax`, `Path=/api/v1/auth`, `Max-Age=300`.
3. Nel callback (`/api/v1/auth/google/callback`), il backend convalida che il parametro `state` coincida esattamente con il cookie. In caso di discrepanza, la richiesta fallisce con `400 Bad Request`.

### 5.3. Prevenzione Account Pre-Hijacking
* Se un utente accede con Google (`sub`, `email`) e l'email esiste già nel DB:
  * Se l'account locale esistente ha `is_verified = FALSE`, **non collegare automaticamente** l'account. Bloccare l'accesso e richiedere prima la verifica dell'account locale (per prevenire che un malintenzionato pre-registri un'email altrui).
  * Se l'account locale ha `is_verified = TRUE`, collegare il provider Google nella tabella `auth_identities`.
* I nuovi account creati direttamente via Google vengono impostati con `is_verified = TRUE` e `password_hash = NULL`.

---

## 6. ARCHITETTURA DI SESSIONE: DPoP (RFC 9449) & REFRESH TOKEN ROTATION

Per azzerare il rischio di clonazione, estrazione o hijacking dei token, l'architettura implementa **Demonstrating Proof-of-Possession at the Application Layer (DPoP)** combinato con rotazione automatica dei token.

```
+-----------------------------------------------------------------------------------------+
|                                    IL FLUSSO DPoP                                       |
+-----------------------------------------------------------------------------------------+
|                                                                                         |
|  1. Inizializzazione Client (Browser):                                                  |
|     - Genera una coppia di chiavi asimmetriche Web Crypto (ECDSA P-256).                |
|     - Chiave privata marcata: extractable = false (impossibile estrarla da JS o XSS).   |
|                                                                                         |
|  2. Richiesta di Login/Refresh:                                                         |
|     - Il client firma un DPoP Proof JWT locale contenente htm (HTTP Method),            |
|       htu (HTTP URI), jti univoco, timestamp iat, e la sua chiave pubblica JWK.         |
|     - Invia la richiesta con l'header DPoP: <dpop_proof_jwt>.                           |
|                                                                                         |
|  3. Convalida Backend:                                                                  |
|     - Verifica la firma della prova con la JWK inclusa.                                 |
|     - Calcola il Thumbprint SHA-256 della JWK (RFC 7638) -> jkt.                        |
|     - Emette un Access Token JWT contenente il claim: cnf: { "jkt": "<jkt_value>" }.    |
|     - Genera un Refresh Token legato al jkt e salvato in refresh_tokens.                |
|                                                                                         |
|  4. Chiamate Protette successive (/api/v1/*):                                            |
|     - Header Authorization: DPoP <access_token>                                         |
|     - Header DPoP: <nuova_prova_firmata_dal_client>                                     |
|     - Il backend rifiuta la richiesta se il token viene inviato da una macchina o       |
|       client diverso (mancanza della chiave privata per generare la DPoP proof).        |
+-----------------------------------------------------------------------------------------+
```

### 6.1. Access Token (Stateless in Memory)
* **Storage Client:** Esclusivamente nella **memoria volatile** dell'applicazione (variabile locale / closure JS / Web Worker). Nessuna persistenza su `localStorage` o `sessionStorage`.
* **Algoritmo di Firma:** RS256 o EdDSA (chiave asimmetrica gestita dal backend).
* **Durata di Validità (TTL):** Breve: **5 – 10 minuti**.
* **Payload Claims:**
  * `sub`: ID utente (UUID).
  * `iss`: `"https://api.nztsolutions.com"`.
  * `exp`: Scadenza timestamp.
  * `jti`: UUID univoco del token.
  * `cnf`: Contiene il Thumbprint della chiave client: `{ "jkt": "<base64url-encoded-sha256-jwk-thumbprint>" }`.

### 6.2. Refresh Token (Stateful in Cookie Hardened)
* **Storage Client:** Cookie impostato dal server con flag massimi:
  * Nome: `__Host-refresh-token`
  * Flag: `HttpOnly=True`, `Secure=True`, `SameSite=Strict`, `Path=/api/v1/auth`, `Max-Age=604800` (7 giorni).
* **Storage Backend:** Non viene mai salvato il token in chiaro. Il backend calcola l'hash `SHA-256` del raw token e lo memorizza nella tabella `refresh_tokens`.

### 6.3. Refresh Token Rotation (RTR) e Rilevamento Riutilizzo (Reuse Detection)
A ogni chiamata verso `/api/v1/auth/refresh`:
1. Il backend estrae il cookie `__Host-refresh-token` e calcola il digest SHA-256.
2. Cerca il record corrispondente nella tabella `refresh_tokens`.
3. **Analisi dello Stato:**
   * **Stato Compromesso (is_used = TRUE):**
     * **ALLARME DI SICUREZZA.** Un token già consumato è stato ripresentato. Questo indica con certezza che il cookie è stato intercettato o duplicato.
     * **Azione immediata:** Il backend revoca l'intera famiglia (`refresh_token_families.is_revoked = TRUE`), cancella il cookie sul client e invalida ogni sessione attiva per l'utente coinvolto. Risposta: `401 Unauthorized`.
   * **Stato Valido (is_used = FALSE e non scaduto):**
     * Il record corrente viene marcato come `is_used = TRUE`.
     * Viene emesso un **nuovo** Refresh Token cryptograficamente casuale (32 byte), inserito in `refresh_tokens` sotto la medesima `family_id`.
     * Viene emesso un nuovo Access Token vincolato al `jkt` originario.
     * Il nuovo Refresh Token viene inviato aggiornando il cookie `__Host-refresh-token`.

### 6.4. Concorrenza tra Schede del Browser (Race Conditions)
Per evitare che schede parallele inviino contemporaneamente la richiesta di refresh (facendo scattare per errore il blocco di reuse detection):
* Il frontend **deve** orchestrare la rotazione del token tramite le Web Locks API native (`navigator.locks.request('nzt_token_refresh', ...)`), assicurando che una sola richiesta di refresh sia in-flight per volta.

---

## 7. DISTRIBUZIONE PROTETTA DEL LAUNCHER

L'eseguibile del Launcher rappresenta il core software e non deve mai essere esposto su URL statici o directory pubbliche.

```
[ Client Autenticato ]
        │
        │ 1. GET /api/v1/downloads/launcher (con Header Authorization DPoP)
        ▼
[ Endpoint FastAPI: downloads.py ]
        │
        ├─► [ Validazione Token DPoP ] ──► Verifica integrità e firma chiave client
        ├─► [ Controllo Entitlement ]  ──► SELECT FROM entitlements WHERE product_code='launcher_core' AND is_enabled=TRUE
        ├─► [ Audit Log ]              ──► INSERT INTO download_logs (...)
        │
        │ 2. Chiamata ad Object Storage (S3/R2 API)
        ▼
[ Generatore Presigned URL ]
        │  Firma HMAC-SHA256 con scadenza: NOW() + 300 secondi (5 minuti)
        ▼
[ Risposta 200 OK ]
{
   "download_url": "https://storage.nztsolutions.com/binaries/launcher/v1.2.0/NZT-Launcher.exe?X-Amz-Signature=...",
   "sha256": "8f462a8... (hash di integrità del file)",
   "version": "1.2.0",
   "expires_in": 300
}
```

### Requisiti di Sicurezza del Binario
1. **Verifica Integrità:** Il client o l'interfaccia deve validare l'hash `SHA-256` fornito dal server per proteggersi da file corrotti o manomessi.
2. **Path Traversal Shield:** Nessun parametro fornito dall'utente (es. query params di versione o path) può essere passato direttamente al filesystem o al bucket. I puntatori ai file sono mappati esclusivamente da enumerazioni server-side.

---

## 8. CONTRATTI DELLE API (OPENAPI SPECIFICATION)

### 8.1. Registrazione Locale
* **Metodo / Path:** `POST /api/v1/auth/register`
* **Headers:** `Content-Type: application/json`, `DPoP: <dpop_proof_jwt>`
* **Request Body:**
  ```json
  {
    "email": "user@domain.com",
    "password": "SuperSecurePassword123!"
  }
  ```
* **Comportamento:**
  * Verifica complessità password (min 12 caratteri, caratteri speciali, numeri).
  * Validazione DPoP proof.
  * Inserimento in `users`, `auth_identities`, creazione `refresh_token_family` legata al `jkt`.
  * Set-Cookie: `__Host-refresh-token=<raw_token>; HttpOnly; Secure; SameSite=Strict; Path=/api/v1/auth; Max-Age=604800`.
* **Response `201 Created`:**
  ```json
  {
    "access_token": "eyJhbGciOiJSUzI1NiIs...",
    "token_type": "DPoP",
    "expires_in": 600
  }
  ```

### 8.2. Login Locale
* **Metodo / Path:** `POST /api/v1/auth/login`
* **Headers:** `Content-Type: application/json`, `DPoP: <dpop_proof_jwt>`
* **Request Body:**
  ```json
  {
    "email": "user@domain.com",
    "password": "SuperSecurePassword123!"
  }
  ```
* **Response `200 OK`:**
  ```json
  {
    "access_token": "eyJhbGciOiJSUzI1NiIs...",
    "token_type": "DPoP",
    "expires_in": 600
  }
  ```
* **Response `401 Unauthorized`:**
  ```json
  {
    "detail": "Invalid email or password"
  }
  ```

### 8.3. Rotazione Token (Refresh)
* **Metodo / Path:** `POST /api/v1/auth/refresh`
* **Headers:** `DPoP: <dpop_proof_jwt>`
* **Cookies:** `__Host-refresh-token=<raw_token>`
* **Comportamento:**
  * Verifica validità prova DPoP e corrispondenza del `jkt` con quello associato alla famiglia del token.
  * Esegue la rotazione RTR.
* **Response `200 OK`:**
  ```json
  {
    "access_token": "eyJhbGciOiJSUzI1NiIs...",
    "token_type": "DPoP",
    "expires_in": 600
  }
  ```

### 8.4. Google OAuth Authorize & Callback
* **GET `/api/v1/auth/google/authorize`**
  * Output: URL di redirect Google contenente `client_id`, `scope=openid email profile`, `code_challenge`, `state`.
  * Set-Cookie: `__Host-oauth-state=<random_state>; HttpOnly; Secure; SameSite=Lax; Path=/api/v1/auth`.
* **POST `/api/v1/auth/google/callback`**
  * Headers: `DPoP: <dpop_proof_jwt>`
  * Request Body: `{ "code": "...", "state": "..." }`
  * Effettua lo scambio token con Google, recupera i claims OIDC e crea la sessione DPoP.

### 8.5. Download Launcher
* **Metodo / Path:** `GET /api/v1/downloads/launcher`
* **Headers:**
  * `Authorization: DPoP <access_token>`
  * `DPoP: <dpop_proof_jwt>`
* **Response `200 OK`:**
  ```json
  {
    "download_url": "https://storage.nztsolutions.com/binaries/NZT-Launcher.exe?token=...",
    "sha256": "4b227777d4dd1fc61c6f884f48641d02b4d121d3fd328cb08b5531fcacdabf8a",
    "version": "1.0.0",
    "expires_in": 300
  }
  ```
* **Response `403 Forbidden`:**
  ```json
  {
    "detail": "User does not have active entitlement for launcher_core"
  }
  ```

---

## 9. CONFIGURAZIONE DEI MIDDLEWARE E HARDENING HTTP

L'agente deve applicare a livello globale in FastAPI un middleware per gli header di risposta e un middleware per il rate limiting.

### 9.1. Header HTTP di Sicurezza Obbligatori
```http
Strict-Transport-Security: max-age=63072000; includeSubDomains; preload
X-Content-Type-Options: nosniff
X-Frame-Options: DENY
Referrer-Policy: strict-origin-when-cross-origin
Permissions-Policy: camera=(), microphone=(), geolocation=()
Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; connect-src 'self' https://accounts.google.com https://oauth2.googleapis.com https://*.nztsolutions.com; frame-ancestors 'none'; base-uri 'self'; form-action 'self';
```

### 9.2. Rate Limiting Basato su Redis
Utilizzare Redis con algoritmo Sliding Window Counter:
* `/api/v1/auth/login`: Massimo **5 richieste al minuto** per singolo IP e per singolo indirizzo email normalizzato.
* `/api/v1/auth/register`: Massimo **3 richieste all'ora** per IP.
* `/api/v1/auth/refresh`: Massimo **30 richieste al minuto** per sessione/famiglia.
* `/api/v1/downloads/*`: Massimo **10 richieste all'ora** per utente.

---

## 10. PIANO D'AZIONE SEQUENZIALE PER L'AGENTE IMPLEMENTATORE

L'agente incaricato della scrittura del codice dovrà procedere seguendo questo ordine per garantire testabilità e coerenza architetturale:

1. **Fase 1: Configurazione Ambiente e Schemi:**
   * Creare il repository FastAPI con configurazione `pydantic-settings` per gestione env sicura.
   * Scrivere le definizioni delle tabelle SQLAlchemy secondo il paragrafo 3 e inizializzare i file di migrazione Alembic.
   * Predisporre le fixture di test con PostgreSQL e Redis isolati (tramite testcontainers o docker-compose di test).
2. **Fase 2: Layer Crittografico e Utilità DPoP:**
   * Implementare il modulo `security.py`: Argon2id hasher/verifier con gestione del timing fittizio.
   * Implementare la convalida del token DPoP RFC 9449: verifica dell'header `DPoP`, decodifica della JWK, calcolo del `jkt` (thumbprint SHA-256) e verifica della corrispondenza di `htm` (metodo) e `htu` (URL target).
3. **Fase 3: Motore di Autenticazione (Locale e Google OIDC):**
   * Sviluppare il gestore di sessioni e la logica di **Refresh Token Rotation (RTR)** con reuse detection.
   * Implementare gli endpoint `/register`, `/login`, `/logout`, `/refresh`.
   * Implementare il client server-to-server HTTP (`httpx`) per l'Authorization Code Flow PKCE con Google, verificando il cookie di stato e i claims OIDC.
4. **Fase 4: Middleware e Hardening:**
   * Aggiungere il middleware di Rate Limiting collegato a Redis.
   * Inserire il middleware per l'iniezione degli header di sicurezza HTTP.
5. **Fase 5: Modulo Entitlements e Launcher Download:**
   * Creare la dependency di autorizzazione `require_entitlement(product_code: str)`.
   * Integrare il client S3/R2 (`aioboto3` o client custom REST) per la generazione di URL di download presigned con scadenza a 300 secondi.
   * Implementare il logging di audit su DB per ogni download autorizzato.