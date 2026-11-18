# NZT Solutions — Architettura di Sicurezza (Master Security Blueprint)

> **Progetto:** Sito Web Ufficiale (`nztsolutions.it`) e futura Area Clienti (`clienti.nztsolutions.it`)  
> **Modello:** Zero-Trust, minimo privilegio, difesa in profondità  
> **Standard di conformità:** OWASP Top 10 (2021) • OWASP API Security Top 10 (2023) • CIS Benchmarks  
> **Ultimo aggiornamento:** 2026-11-18 — vedi [Registro delle modifiche](#15-registro-delle-modifiche)

Questo è il documento **vincolante** per tutto ciò che riguarda la sicurezza del progetto. Contiene due cose
insieme: le **regole** (il blueprint) e lo **stato reale** della loro applicazione nel repository.

---

## 0. Come si usa e come si aggiorna

**Regola di manutenzione.** Ogni modifica che tocca la sicurezza (un header, un controllo su un endpoint,
una dipendenza, il container, la pipeline, la configurazione di Cloudflare o Railway) si chiude solo quando:

1. la sezione interessata di questo documento descrive il nuovo comportamento;
2. la riga corrispondente della [tabella di stato](#02-stato-di-applicazione) è aggiornata;
3. c'è una voce nuova nel [Registro delle modifiche](#15-registro-delle-modifiche);
4. i test di sicurezza passano (`pnpm test`) e coprono il comportamento nuovo.

**Legenda dello stato**

| Simbolo | Significato |
| :-- | :-- |
| ✅ | Applicato nel repository e coperto da test |
| 🔧 | Richiede un'azione manuale fuori dal repository (Cloudflare, Railway, DNS, GitHub): vedi [§11](#11-checklist-operativa-fuori-dal-repository) |
| ⏳ | Il componente oggi non esiste nel progetto: la regola è vincolante dal momento in cui verrà introdotto |

### 0.1 Stack di riferimento e stack reale

Il blueprint è scritto per lo stack completo (frontend + backend + database). Oggi il repository contiene
solo il sito: lo stack reale è più piccolo, e questo riduce la superficie d'attacco.

| Componente del blueprint | Oggi nel progetto |
| :-- | :-- |
| Astro (TypeScript) | **Presente.** Astro 7, pagine statiche prerenderizzate + isole React |
| Server applicativo | **Presente.** Node 22 (`@astrojs/node`), avviato da `server/index.mjs` su Railway |
| API | **Presente, una sola rotta:** `POST /api/contact` (modulo contatti → email via Resend) |
| Python (FastAPI/ASGI) | **Assente.** Previsto per l'Area Clienti |
| PostgreSQL / MongoDB / Redis | **Assenti.** Nessun dato persistito dal sito |
| Autenticazione, sessioni, token | **Assenti.** Nessun utente, nessun cookie di sessione |
| Upload di file | **Assente** |
| Cloudflare | Turnstile attivo sul modulo; proxy/WAF davanti al dominio da completare ([§11](#11-checklist-operativa-fuori-dal-repository)) |
| Railway | **Presente.** Deploy da `Dockerfile` |

### 0.2 Stato di applicazione

| § | Regola | Stato | Dove |
| :-- | :-- | :-: | :-- |
| 1.1 | Nessun database con endpoint pubblico; solo rete privata Railway (MongoDB esterno: database per servizio, IP Access List, TLS verificato) | ✅ Redis · 🔧 IP Access List del cluster MongoDB | `apps/api/src/app/config.py` (guardie TLS) |
| 1.2 | Origin IP cloaking: l'origine risponde solo a Cloudflare (`X-Origin-Verify`) | ✅ codice · 🔧 attivazione | `server/create-server.mjs`, `server/origin-verify.mjs` |
| 1.2 | IP del client ricavato solo da proxy verificati | ✅ | `server/client-ip.mjs` |
| 1.2 | Proxy Cloudflare, WAF, TLS minimo, DNSSEC, CAA | 🔧 | Cloudflare / registrar |
| 2.1 | `security.checkOrigin` attivo + controllo stessa origine sulle API | ✅ | `astro.config.mjs`, `src/lib/security/request-guards.ts` |
| 2.2 | Security header su **ogni** risposta, CSP senza `unsafe-inline`/`unsafe-eval` per gli script | ✅ | `server/security-headers.mjs`, `server/csp-hashes.mjs`, `src/middleware.ts` |
| 2.3 | Nessun `set:html` / `dangerouslySetInnerHTML` con dati non fidati | ✅ (nessun uso nel codice) | — |
| 3.1 | Validazione a schema rigoroso, chiavi extra rifiutate | ✅ (Zod strict) · ⏳ Pydantic | `src/lib/contact-schema.ts` |
| 3.2 | Query parametrizzate, anti-IDOR/BOLA, anti NoSQL-injection | ✅ Area Clienti (MongoDB, scenario B) | `apps/api/src/app/db.py`, `apps/api/src/app/schema.py`, `apps/api/tests/test_mongo.py` |
| 3.3 | Mitigazione SSRF | ✅ (solo host costanti) · ⏳ validazione IP | `src/lib/turnstile.ts`, `src/lib/email.ts` |
| 3.4 | Rate limiting degli endpoint critici | ✅ in memoria · ⏳ Redis con più repliche | `src/lib/security/rate-limit.ts` |
| 4 | Argon2id, cookie HttpOnly, rotazione refresh token | ⏳ | — |
| 5 | Upload sicuri | ⏳ | — |
| 6 | Container multi-stage, non-root, minimale | ✅ | `Dockerfile`, `.dockerignore`, `railway.json` |
| 7 | Secret scanning, audit dipendenze, scansione immagine in CI | ✅ codice · 🔧 protezione del branch | `.github/workflows/security.yml`, `.github/dependabot.yml`, `.pre-commit-config.yaml` |
| 8 | Log JSON strutturati, credenziali mascherate, audit trail | ✅ | `server/logger.mjs`, `src/lib/contact-handler.ts` |

---

## 1. Architettura di Rete e Perimetro (Edge & Railway)

### 1.1 Isolamento Rete Railway (Zero Public DB) — ⏳

- **Regola assoluta:** nessun database (PostgreSQL, MongoDB, Redis) deve esporre un endpoint TCP pubblico
  (_Public TCP Proxy_).
- **Comunicazione interna mesh:** il backend comunica con i database esclusivamente tramite la rete privata
  IPv6 interna di Railway.
  - PostgreSQL: `postgres.railway.internal:5432` (via `${{Postgres.DATABASE_URL}}`)
  - MongoDB: `mongodb.railway.internal:27017` (via `${{MongoDB.MONGO_URL}}`)
  - Redis: `redis.railway.internal:6379` (via `${{Redis.REDIS_URL}}`)

**Stato.** Il sito pubblico non ha database. L'Area Clienti (`apps/api`) usa Redis sulla rete privata Railway e un
**MongoDB esterno** (cluster condiviso tra i servizi NZT per avere un solo servizio database da pagare), che per
definizione non è sulla rete privata Railway. Per quel cluster la regola diventa:

- **un database per servizio** e utenti limitati a quel database (l'API usa un ruolo custom con sole operazioni
  CRUD sulle proprie collection, schema applicato da un utente separato);
- **IP Access List** del cluster limitata agli IP di uscita dei servizi (o private endpoint / peering), mai
  `0.0.0.0/0`;
- **TLS obbligatorio** con verifica di certificato e hostname e autenticazione SCRAM: l'API rifiuta di avviarsi in
  produzione con un URI senza credenziali o con opzioni che indeboliscono TLS.

Dettagli e verifiche: `docs/architettura_sicurezza_area_clienti.md` §16.

### 1.2 Origin IP Cloaking e WAF Cloudflare

**Regole**

- **Proxy arancione:** tutto il traffico verso il sito deve passare da Cloudflare.
- **Blocco degli accessi diretti:** l'applicazione rifiuta con `403 Forbidden` qualsiasi richiesta priva
  dell'header segreto `X-Origin-Verify` (64 caratteri esadecimali casuali, aggiunto da una Transform Rule di
  Cloudflare).
- **DNS e TLS:** TLS minimo 1.3 al bordo, cifrari deboli disattivati, DNSSEC attivo, record CAA.

**Perché l'header e non mTLS.** Il blueprint ammette due alternative: Authenticated Origin Pulls (mTLS)
oppure l'header segreto. Su Railway la connessione TLS termina sull'edge di Railway, non nel nostro
container: il certificato client di Cloudflare non arriverebbe mai all'applicazione. L'header segreto è
quindi l'unica delle due opzioni realizzabile.

**Implementazione — il perimetro applicativo**

In produzione il processo non parte da `dist/server/entry.mjs` ma da **`server/index.mjs`**, che avvolge
l'handler di Astro. È il confine di fiducia: ogni richiesta, anche per una pagina statica o un file in
`/_astro/`, passa da qui (il middleware di Astro, da solo, non vede i file statici).

Controlli eseguiti nell'ordine (`server/create-server.mjs`):

| # | Controllo | Esito in caso di violazione |
| :-: | :-- | :-- |
| 1 | Header di sicurezza impostati subito, quindi presenti anche sulle risposte di errore | — |
| 2 | Forma dell'URL: deve iniziare con `/` (non `//`), ≤ 2048 caratteri, decodificabile, senza byte nulli | `400` / `414` |
| 3 | `GET /healthz`: healthcheck di Railway, unico path esente dal punto 4 | `200 ok` |
| 4 | Verifica dell'origine (se `ORIGIN_VERIFY_SECRET` è impostato): confronto a tempo costante | `403` |
| 5a | Metodi: `GET`/`HEAD` ovunque, `POST` solo su `/api/contact`, nient'altro | `405` |
| 5b | Endpoint interni del framework non usati (`/_image`, `/_server-islands`, `/_actions`) | `404` |
| 5c | Corpo: nessun corpo sulle `GET`; `Content-Length` ≤ 16 KB sulle `POST` | `400` / `413` |
| 6 | Passaggio ad Astro con un contesto di fiducia (id richiesta, IP del client) | — |

Dettagli che contano:

- **Il segreto non prosegue.** Dopo la verifica l'header `X-Origin-Verify` viene rimosso dalla richiesta:
  l'applicazione non lo vede e non può finire in un log.
- **Fail-fast.** Un `ORIGIN_VERIFY_SECRET` presente ma malformato (non 64 caratteri esadecimali) impedisce
  l'avvio. Railway, vedendo fallire l'healthcheck, lascia attivo il deploy precedente.
- **Segreto assente.** Il server parte comunque (per non causare un fuori servizio al primo deploy) ma
  scrive a ogni avvio l'evento `origin_verification_disabled`. L'attivazione è un passo di [§11](#11-checklist-operativa-fuori-dal-repository).
- **Il decision path è normalizzato.** I controlli 5a–5b si basano su un path decodificato, senza `..` né
  barre doppie, in minuscolo: `/_IMAGE`, `/%5Fimage`, `/x/../_image` sono tutti bloccati.
- **Timeout anti-slowloris:** 15 s per gli header, 30 s per l'intera richiesta; keep-alive a 65 s, sopra i
  60 s dell'edge di Railway.

**Implementazione — IP del client (`server/client-ip.mjs`)**

Gli header di inoltro sono testo che chiunque può scrivere. Prima di questo intervento il rate limit si
fidava di `CF-Connecting-IP` e `X-Forwarded-For` senza condizioni: bastava cambiarne il valore a ogni
richiesta per aggirarlo. Ora ogni header è creduto solo se il proxy che lo scrive è verificato:

| Situazione | Fonte dell'IP |
| :-- | :-- |
| Richiesta passata da Cloudflare (segreto verificato) | `CF-Connecting-IP` |
| Processo su Railway, senza segreto verificato | `X-Real-IP` (impostato dall'edge di Railway) |
| Nessun proxy fidato (locale, test) | indirizzo della connessione TCP |

L'IP risolto arriva alla rotta API tramite `AsyncLocalStorage` (`server/request-context.mjs`), non tramite
un header: non esiste un canale che il client possa falsificare.

> **Conseguenza operativa.** Con il proxy Cloudflare attivo ma senza `ORIGIN_VERIFY_SECRET`, l'IP visto è
> quello dei nodi Cloudflare: il rate limit raggruppa utenti diversi. Attivare il proxy e il segreto insieme.

---

## 2. Frontend Security: Astro & TypeScript

### 2.1 Configurazione globale Astro — ✅

```javascript
// astro.config.mjs (estratto)
export default defineConfig({
  output: 'static', // pagine prerenderizzate; solo /api/contact gira a richiesta
  adapter: node({ mode: 'standalone', bodySizeLimit: 4 * MAX_BODY_BYTES }),
  security: {
    // Rifiuta POST/PUT/PATCH/DELETE se l'header Origin non coincide con l'host
    checkOrigin: true,
  },
});
```

**Scostamento motivato dal blueprint.** Il blueprint indica `output: 'server'`. Il sito resta `static`: le
pagine sono file già pronti, non c'è codice eseguito a ogni visita (meno superficie d'attacco e TTFB
migliore). Gli header, che in modalità statica il middleware non potrebbe applicare, li applica il
perimetro di [§1.2](#12-origin-ip-cloaking-e-waf-cloudflare).

**Anti-CSRF sull'API.** `checkOrigin` di Astro copre i form classici. L'endpoint aggiunge due controlli
propri (`src/lib/security/request-guards.ts`):

- accetta solo `Content-Type: application/json` (un form HTML di un altro sito non può produrlo);
- `Sec-Fetch-Site`, se presente, deve valere `same-origin`; `Origin`, se presente, deve avere lo stesso host
  della richiesta (`Host` o `X-Forwarded-Host`). In caso contrario: `403`.

Nessuna intestazione CORS viene emessa: l'API non è utilizzabile da altre origini.

### 2.2 Security header — ✅

Tutte le risposte (pagine, asset, API, errori) includono:

| Header | Valore |
| :-- | :-- |
| `Content-Security-Policy` | vedi sotto |
| `Strict-Transport-Security` | `max-age=31536000; includeSubDomains; preload` |
| `X-Content-Type-Options` | `nosniff` |
| `X-Frame-Options` | `DENY` |
| `Referrer-Policy` | `strict-origin-when-cross-origin` |
| `Permissions-Policy` | `camera=(), microphone=(), geolocation=(), payment=(), usb=(), midi=(), display-capture=(), browsing-topics=()` |
| `Cross-Origin-Opener-Policy` | `same-origin` |
| `X-Permitted-Cross-Domain-Policies` | `none` |
| `X-Request-Id` | identificativo della richiesta, lo stesso riportato nei log |

Definizione unica in `server/security-headers.mjs`, usata sia dal perimetro sia da `src/middleware.ts`.

**Content Security Policy delle pagine**

```text
default-src 'self';
script-src 'self' 'sha256-…' 'sha256-…' https://challenges.cloudflare.com;
style-src 'self' 'unsafe-inline';          (fallback per browser datati)
style-src-elem 'self' 'sha256-…';          (blocchi <style>: solo per hash)
style-src-attr 'unsafe-inline';            (attributi style="…")
img-src 'self' data: blob:;
font-src 'self';
connect-src 'self';
frame-src https://challenges.cloudflare.com;
worker-src 'self' blob:;
manifest-src 'self'; media-src 'self';
object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none';
upgrade-insecure-requests                  (solo con NODE_ENV=production)
```

- **Script: nessun `'unsafe-inline'`, nessun `'unsafe-eval'`.** Astro inserisce nell'HTML alcuni script
  inline (avvio delle isole React, lo script `nav-gate` del layout). Sono ammessi **solo per hash**:
  l'integrazione `cspHashesIntegration` (`server/csp-hashes.mjs`), a fine build, legge ogni pagina
  generata, calcola lo SHA-256 di ogni blocco inline e scrive `dist/server/csp-hashes.json`; il server lo
  legge all'avvio. Se uno script inline cambia, il suo hash cambia al build successivo: non c'è nulla da
  mantenere a mano. Se il file manca o è alterato, il server non parte.
- **Unica origine esterna:** `challenges.cloudflare.com` (Turnstile).
- **`style-src-attr 'unsafe-inline'`** resta necessario: React (SSR delle isole), GSAP e Three.js scrivono
  attributi `style`. È il residuo dichiarato in [§12](#12-rischi-residui-e-decisioni-aperte).
- **Risposte delle API** e di rifiuto: CSP chiusa `default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'`,
  più `Cache-Control: no-store` e `Cross-Origin-Resource-Policy: same-origin`.

**Vincoli per chi sviluppa**

- Niente gestori di eventi inline (`onclick="…"`) e niente `javascript:` negli URL: la CSP li blocca.
- Una nuova origine esterna (font, analytics, video) va aggiunta in `server/security-headers.mjs`, motivata
  qui e coperta da test.
- Zod va importato da `@/lib/zod`, non da `zod`: quel modulo attiva la modalità _jitless_, senza la quale
  Zod 4 prova un `new Function()` che la CSP blocca e segnala.
- Una futura pagina **SSR** (non prerenderizzata) con script inline non rientra negli hash calcolati al
  build: richiederà una CSP con _nonce_ per richiesta.

### 2.3 Prevenzione XSS nel rendering — ✅

- **Divieto di `set:html` non sanitizzato:** mai iniettare stringhe utente in `set:html` (Astro) o
  `dangerouslySetInnerHTML` (React). Oggi il codice non usa nessuno dei due.
- Se servirà renderizzare Markdown o HTML di terzi, sanitizzazione obbligatoria lato server:

  ```typescript
  import sanitizeHtml from 'sanitize-html';

  const cleanHtml = sanitizeHtml(untrustedInput, {
    allowedTags: ['b', 'i', 'em', 'strong', 'a', 'p', 'ul', 'li', 'code', 'pre'],
    allowedAttributes: { a: ['href', 'rel', 'target'] },
    transformTags: {
      a: sanitizeHtml.simpleTransform('a', { rel: 'noopener noreferrer nofollow' }),
    },
  });
  ```

- I dati del modulo contatti non vengono mai resi come HTML: l'email è inviata come **solo testo**.
- La pagina 404 è `src/pages/404.astro`: quella predefinita di Astro dichiarava il framework in uso.

---

## 3. Backend Security

Il backend di oggi è l'unica rotta `POST /api/contact` (Node). Le regole per Python/FastAPI restano qui,
vincolanti per l'Area Clienti. I principi sono gli stessi; cambia lo strumento.

### 3.1 Validazione rigorosa e prevenzione mass-assignment

**Regola.** Nessun dato grezzo passa alla logica o a un servizio esterno senza validazione a schema. Le
chiavi non previste fanno fallire la richiesta.

**Implementazione attuale — ✅ (`src/lib/contact-schema.ts`, Zod 4)**

- `z.strictObject`: una chiave extra (`isAdmin`, `role`, …) produce `400`.
- Solo scalari tipizzati, con lunghezza massima; `service` è un elenco chiuso di valori.
- Un oggetto al posto di una stringa (`{"email": {"$ne": null}}`) è rifiutato.
- Campi a riga singola (nome, azienda, telefono): nessun carattere di controllo né a capo, perché entrano
  nell'oggetto dell'email (_header injection_). Nel messaggio sono ammessi solo a capo e tabulazioni.
- Il corpo si legge con un limite reale di 16 KB (`readJsonBody`): la lettura si interrompe al superamento,
  anche con `Transfer-Encoding: chunked` o un `Content-Length` falso.
- Anche la risposta di Cloudflare Turnstile è validata con uno schema, come ogni input esterno.

**Regola per FastAPI — ⏳ (Pydantic v2)**

```python
from pydantic import BaseModel, EmailStr, Field, ConfigDict

class StrictModel(BaseModel):
    # Rifiuta chiavi extra non definite nello schema (Anti-Mass Assignment)
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

class UserRegisterSchema(StrictModel):
    email: EmailStr
    username: str = Field(min_length=3, max_length=30, pattern=r"^[a-zA-Z0-9_-]+$")
    password: str = Field(min_length=12, max_length=128)
```

### 3.2 Prevenzione injection (database layer) — ⏳

Il sito non interroga alcun database. Regole vincolanti dal primo accesso ai dati.

#### Scenario A: PostgreSQL + SQLAlchemy 2.0

- Solo query parametrizzate gestite dall'ORM. Vietata ogni interpolazione di stringhe (`f"SELECT ..."`).
- Identificatori **UUIDv7** al posto di ID interi incrementali (mitiga l'enumerazione IDOR).
- Controllo di ownership **dentro la query**, su ogni accesso a una risorsa di un utente.

```python
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
import uuid

async def get_user_order(db: AsyncSession, order_id: uuid.UUID, current_user_id: uuid.UUID):
    # Controllo di autorizzazione contestuale a livello di query (Anti-IDOR / Anti-BOLA)
    stmt = select(Order).where(Order.id == order_id, Order.user_id == current_user_id)
    result = await db.execute(stmt)
    return result.scalar_one_or_none()
```

#### Scenario B: MongoDB (Motor / PyMongo)

- **NoSQL operator injection:** mai accettare dizionari liberi (`dict`) nei filtri di query.
- Validare i tipi con Pydantic garantendo parametri scalari (`str`, `int`), così che l'utente non possa
  iniettare operatori come `{"$gt": ""}` o `{"$ne": null}`.
- **Applicato nell'Area Clienti (`apps/api`, PyMongo async):** filtri costruiti solo da valori tipizzati lato
  server, nessun operatore JavaScript lato server, validatori `$jsonSchema` strict su ogni collection, `_id` UUID
  (non enumerabili); verificato da `apps/api/tests/test_mongo.py`.

```python
# VULNERABILE:
# db.users.find_one({"email": request_json["email"], "password": request_json["password"]})

# SICURO:
class MongoLoginFilter(StrictModel):
    email: EmailStr
    password: str

async def secure_find_user(payload: MongoLoginFilter):
    # Pydantic garantisce che payload.email sia una stringa pura, bloccando payload con operatori
    user = await db.users.find_one({"email": payload.email})
    ...
```

### 3.3 Mitigazione SSRF

**Implementazione attuale — ✅.** Il server effettua solo due chiamate in uscita, entrambe verso URL
**costanti nel codice**: `https://challenges.cloudflare.com/turnstile/v0/siteverify` e
`https://api.resend.com/emails`. Nessun dato dell'utente concorre a formare l'host o il path; i redirect
non vengono seguiti (`redirect: 'error'`); ogni chiamata ha un timeout. L'endpoint `/_image` di Astro, che
accetta un URL come parametro, è bloccato dal perimetro.

**Regola per chiamate verso URL forniti dall'utente — ⏳** (webhook, fetch di URL esterni): validare l'IP
risolto prima della richiesta.

```python
import ipaddress
import socket
from urllib.parse import urlparse
from fastapi import HTTPException

BLOCKED_NETWORKS = [
    ipaddress.ip_network("127.0.0.0/8"),      # Loopback
    ipaddress.ip_network("10.0.0.0/8"),       # Private RFC 1918
    ipaddress.ip_network("172.16.0.0/12"),    # Private RFC 1918
    ipaddress.ip_network("192.168.0.0/16"),   # Private RFC 1918
    ipaddress.ip_network("169.254.0.0/16"),   # Link-local / Cloud Metadata
    ipaddress.ip_network("::1/128"),          # IPv6 loopback
    ipaddress.ip_network("fc00::/7"),         # IPv6 local
]

def validate_outgoing_url(target_url: str):
    parsed = urlparse(target_url)
    if parsed.scheme not in ("http", "https"):
        raise HTTPException(status_code=400, detail="Schema URL non valido")

    hostname = parsed.hostname
    if not hostname:
        raise HTTPException(status_code=400, detail="Hostname assente")

    # Risoluzione DNS e validazione dell'IP
    addr_info = socket.getaddrinfo(hostname, None)
    for family, _, _, _, sockaddr in addr_info:
        ip = ipaddress.ip_address(sockaddr[0])
        for blocked_net in BLOCKED_NETWORKS:
            if ip in blocked_net:
                raise HTTPException(status_code=403, detail="Destinazione di rete non autorizzata (SSRF Blocked)")
```

> Nota di implementazione: la richiesta va poi fatta **verso l'IP già validato** (non risolvendo di nuovo
> il nome), altrimenti resta aperta la finestra del _DNS rebinding_. Aggiungere alla lista anche
> `fe80::/10` e la rete privata `*.railway.internal`.

### 3.4 Rate limiting

**Implementazione attuale — ✅ (`src/lib/security/rate-limit.ts`)**

| Limite | Valore | Scopo |
| :-- | :-- | :-- |
| Per client | 5 richieste / 10 minuti | Abuso da una singola sorgente |
| Globale | 30 email / ora | Attacco distribuito che supera il captcha; protegge casella e quota Resend |

- Finestra scorrevole in memoria, con consumo limitato per costruzione: al più 5 valori per chiave e al
  più 10 000 chiavi. Prima la mappa poteva crescere senza limite.
- Chiave: l'IPv4 intero, oppure il prefisso **/64** per IPv6 (un singolo utente dispone di un intero /64).
- Al superamento: `429` con `Retry-After`; il modulo propone l'email precompilata.
- Davanti a tutto resta la verifica Cloudflare Turnstile (con controllo dell'azione e, se configurato
  `TURNSTILE_ALLOWED_HOSTNAMES`, dell'hostname) e il campo honeypot.

**Limite noto.** Lo stato è nel processo: vale per **una sola istanza**. Con più repliche su Railway serve
uno store condiviso, implementando la stessa interfaccia `RateLimiter`.

**Regola per FastAPI e per il multi-istanza — ⏳ (SlowAPI + Redis)**

```python
from fastapi import FastAPI, Request
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.util import get_remote_address
from slowapi.errors import RateLimitExceeded

limiter = Limiter(
    key_func=get_remote_address,
    storage_uri="redis://redis.railway.internal:6379"
)

app = FastAPI()
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

@app.post("/api/v1/auth/login")
@limiter.limit("5/minute")
async def login(request: Request, ...):
    ...
```

> `get_remote_address` va sostituita con una funzione che applichi la stessa regola di [§1.2](#12-origin-ip-cloaking-e-waf-cloudflare):
> dietro un proxy restituirebbe l'IP del proxy, e fidarsi di `X-Forwarded-For` lo renderebbe aggirabile.

---

## 4. Gestione Autenticazione, Sessioni e Token — ⏳

Il sito non ha utenti né sessioni: non emette cookie e non usa `localStorage`/`sessionStorage`. Regole
vincolanti per l'Area Clienti.

### 4.1 Hashing delle password

Uso esclusivo di **Argon2id** (vincitore della Password Hashing Competition), parametri minimi: $t=3$
iterazioni, $m=65536\,\text{KB}$ (64 MB), $p=4$ parallelismo. Libreria: `argon2-cffi`.

```python
from argon2 import PasswordHasher
from argon2.exceptions import VerifyMismatchError

ph = PasswordHasher(time_cost=3, memory_cost=65536, parallelism=4)

def hash_password(password: str) -> str:
    return ph.hash(password)

def verify_password(hashed: str, password: str) -> bool:
    try:
        return ph.verify(hashed, password)
    except VerifyMismatchError:
        return False
```

### 4.2 Storage e trasmissione dei token

- **Vietato `localStorage`:** nessun token di autenticazione nello storage del browser.
- **Cookie HttpOnly:**
  - `access_token`: durata breve (10–15 minuti), cookie `HttpOnly; Secure; SameSite=Lax`.
  - `refresh_token`: durata medio-lunga (7 giorni), memorizzato lato server solo come hash crittografico
    (Redis/Postgres) per il tracciamento della sessione.
- **Rotazione dei refresh token:** a ogni uso il token precedente è invalidato e ne viene emesso uno nuovo.
  Se viene presentato un refresh token già revocato, il server assume la compromissione e invalida
  all'istante l'intera famiglia di token dell'utente (_Token Reuse Detection_).

> Da ricordare quando l'Area Clienti nascerà su `clienti.nztsolutions.it`: un cookie con
> `Domain=nztsolutions.it` sarebbe inviato anche al sito vetrina. Usare cookie _host-only_ (prefisso
> `__Host-`) sul sottodominio.

---

## 5. File Upload Security — ⏳

Mai salvare i file caricati sul file system del container o nella web root.

1. **Pre-signed URL:** il client riceve dal backend un URL pre-firmato per caricare il file direttamente su
   Object Storage (AWS S3, Cloudflare R2).
2. **Magic bytes:** se il backend elabora il file, validare la firma binaria reale (`python-magic`),
   ignorando il MIME-type dichiarato dall'header HTTP.
3. **Nome casuale:** rinominare il file con `uuid.uuid4()`:
   ```python
   safe_filename = f"{uuid.uuid4().hex}.{allowed_extension}"
   ```
4. **Header di download:** forzare sempre `Content-Disposition: attachment; filename="..."` per impedire
   l'esecuzione di file HTML/SVG nel browser della vittima.

**Stato.** Il sito non accetta upload: il perimetro rifiuta qualsiasi corpo oltre 16 KB e il container gira
con file system in sola lettura.

---

## 6. Container Hardening (Docker su Railway) — ✅

Il deploy su Railway usa il `Dockerfile` del repository (`railway.json` → `builder: DOCKERFILE`).

| Misura | Come |
| :-- | :-- |
| Multi-stage | Stadio di build con pnpm e toolchain; stadio finale con il solo risultato |
| Nessuna dipendenza npm a runtime | Il bundle server è autosufficiente (`vite.ssr.noExternal`): nell'immagine finale ci sono solo `dist/` e `server/`, senza `node_modules` |
| Nessun gestore di pacchetti | `npm`, `npx`, `corepack`, `yarn` rimossi dall'immagine finale |
| Base minimale | Stadio finale su `node:22-alpine` |
| Immagini fissate per digest | `FROM …@sha256:…`; le aggiorna Dependabot |
| Utente non privilegiato | `appuser` (uid/gid 10001), shell `nologin` |
| Codice in sola lettura | I file appartengono a root: il processo non può modificare ciò che esegue |
| Nessun segreto nei layer | Solo `PUBLIC_TURNSTILE_SITE_KEY` (pubblica per natura) è un `ARG` di build |
| `.dockerignore` | `.git`, `.env*`, `docs`, `tests` e simili restano fuori dal contesto di build |
| Arresto ordinato | `CMD` in forma exec: Node riceve `SIGTERM` e chiude le connessioni |
| Healthcheck | `GET /healthz` (Railway e `HEALTHCHECK` Docker) |

Verificato eseguendo l'immagine con `--read-only --cap-drop=ALL --security-opt no-new-privileges`.
Risultato della scansione Trivy sull'immagine finale (2026-11-15): nessuna vulnerabilità alta o critica,
una di livello medio nel sistema operativo, zero rilievi sul Dockerfile.

**Regola per il backend Python — ⏳** (multi-stage rootless, stesso principio):

```dockerfile
# ----------------- Build Stage -----------------
FROM python:3.12-slim AS builder

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

WORKDIR /install

RUN apt-get update && apt-get install -y --no-install-recommends \
    gcc \
    libpq-dev \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir --prefix=/install -r requirements.txt

# ----------------- Final Minimal Stage -----------------
FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

# Creazione gruppo e utente non privilegiato (Principio del Minimo Privilegio)
RUN groupadd -g 10001 appgroup && \
    useradd -u 10001 -g appgroup -s /sbin/nologin -d /app appuser

WORKDIR /app

# Copia delle sole librerie precompilate e del codice
COPY --from=builder /install /usr/local
COPY --chown=appuser:appgroup . /app

# Esecuzione come utente non-root
USER appuser

EXPOSE 8000

# Avvio con Uvicorn omettendo l'header "Server: uvicorn" (Information Disclosure Prevention)
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000", "--no-server-header"]
```

---

## 7. Pipeline CI/CD e Secrets Management — ✅ / 🔧

**Zero secrets in repository**

- **Gitleaks** è uno step bloccante della pipeline (`.github/workflows/security.yml`, sull'intera
  cronologia) e un hook pre-commit (`.pre-commit-config.yaml`; attivazione per clone:
  `pipx install pre-commit && pre-commit install`).
- `.gitignore` esclude `.env` e ogni `.env.*` tranne `.env.example`, che contiene solo le chiavi di test
  pubbliche di Cloudflare.
- I segreti vivono solo nelle Variables di Railway. Elenco e scopo:

  | Variabile | Segreto | Letta da | Note |
  | :-- | :-: | :-- | :-- |
  | `PUBLIC_TURNSTILE_SITE_KEY` | no | build | Finisce nel bundle del browser |
  | `TURNSTILE_SECRET_KEY` | sì | runtime | Senza, in produzione il modulo non accetta invii |
  | `TURNSTILE_ALLOWED_HOSTNAMES` | no | runtime | Raccomandata: `nztsolutions.it,www.nztsolutions.it` |
  | `RESEND_API_KEY` | sì | runtime | Chiave con solo permesso di invio, limitata al dominio |
  | `CONTACT_TO_EMAIL`, `CONTACT_FROM_EMAIL` | no | runtime | |
  | `ORIGIN_VERIFY_SECRET` | sì | runtime | `openssl rand -hex 32`; lo stesso valore in Cloudflare |

**Pipeline `Security`** — su ogni pull request, su ogni push a `main` e ogni lunedì (una vulnerabilità
pubblicata dopo l'ultimo commit emerge anche se il codice non cambia):

| Job | Controlli bloccanti |
| :-- | :-- |
| `secrets` | Gitleaks sulla cronologia completa |
| `app` | `pnpm audit --audit-level=high` · ESLint · `astro check` + build · test unitari e di integrazione |
| `container` | Trivy sul `Dockerfile` · build dell'immagine · Trivy sull'immagine (alte e critiche) · prova che l'origine risponde `403` senza segreto e che il processo non è root |

Il workflow ha permessi di sola lettura (`contents: read`) e non conserva le credenziali del checkout.

**Aggiornamenti:** Dependabot settimanale per pacchetti npm, immagini Docker e GitHub Actions.

**Per il backend Python — ⏳:** `pip-audit` e `bandit -r ./app` come step bloccanti aggiuntivi.

**Test di sicurezza** (`pnpm test`): 111 test.

- `tests/unit/` — schema, rate limiter, controlli sulla richiesta, IP del client, verifica dell'origine,
  configurazione, logger, header, hash CSP, Turnstile, email, handler dei contatti, perimetro.
- `tests/integration/` — avvia il vero server di produzione sul build in `dist/` e verifica, tra l'altro,
  che **ogni** script e stile inline di **ogni** pagina sia coperto dalla CSP servita.

---

## 8. Logging e Audit Trail — ✅

- **Structured logging:** una riga JSON per evento (`server/logger.mjs`), su stdout/stderr, leggibile dai
  log di Railway e da qualsiasi aggregatore (Loki, Datadog).
- **Mascheramento delle credenziali:** prima della scrittura ogni campo il cui nome richiama `password`,
  `token`, `authorization`, `secret`, `cookie`, `api_key`, `credit_card`, `cvv`, `origin-verify` viene
  sostituito con `[REDACTED]`, a qualunque profondità.
- **Minimizzazione dei dati personali:** dei dati del modulo (nome, email, azienda, telefono, messaggio)
  non si registra **nulla**; in caso di payload non valido si registrano solo i nomi dei campi rifiutati.
  Gli IP sono troncati (`/24` per IPv4, `/48` per IPv6).
- **Nessuna riga falsificabile:** i valori passano da `JSON.stringify`; un a capo in un input non può
  creare una riga di log finta.
- **Anti-flooding:** gli eventi che un attaccante può generare a volontà sul perimetro sono limitati a 30
  righe al minuto, poi contati e riassunti (`security_log_suppressed`).

**Eventi di sicurezza registrati**

| Evento | Quando |
| :-- | :-- |
| `origin_verify_failed` | Richiesta all'origine senza segreto valido (`403`) |
| `method_not_allowed`, `blocked_internal_endpoint`, `payload_too_large` | Rifiuti del perimetro |
| `contact_forbidden_origin` | Richiesta all'API da un'altra origine (`403`) |
| `contact_rate_limited` | Blocco del rate limiter, con `scope: ip` oppure `global` |
| `contact_invalid_payload` | Corpo troppo grande, JSON malformato, schema violato |
| `contact_honeypot` | Campo trappola compilato |
| `contact_captcha_failed` | Token Turnstile assente o rifiutato |
| `contact_unavailable`, `contact_send_failed` | Configurazione mancante o errore di Resend |
| `contact_sent` | Invio riuscito (solo id richiesta, IP troncato, tipo di servizio) |
| `origin_verification_disabled` | Avvio in produzione senza `ORIGIN_VERIFY_SECRET` |

**Per l'Area Clienti — ⏳:** registrare inoltre i tentativi di autenticazione falliti, le modifiche a ruoli
e permessi (RBAC) e ogni `403` su accesso a risorse altrui (IDOR).

---

## 9. Dipendenze e supply chain — ✅

- Aggiornamento del 2026-11-15: **Astro 5.18 → 7.4**, `@astrojs/node` 9 → 11, `@astrojs/react` 4 → 7,
  Zod 3 → 4. `pnpm audit` sulle dipendenze di produzione è passato da **24 vulnerabilità** (1 critica,
  7 alte) a zero alte o critiche.
- L'SDK `resend` è stato sostituito da una chiamata `fetch` diretta (`src/lib/email.ts`): meno pacchetti
  transitivi da tenere aggiornati.
- `pnpm install --frozen-lockfile` in CI e nel Dockerfile: si installa solo ciò che è nel lockfile.
- `onlyBuiltDependencies` in `package.json`: solo `esbuild` e `sharp` possono eseguire script di installazione.
- A runtime l'immagine non contiene alcun pacchetto npm ([§6](#6-container-hardening-docker-su-railway--)).

---

## 10. Misure aggiuntive rispetto al blueprint

Emerse dalla verifica successiva all'implementazione e già applicate:

| Misura | Motivo |
| :-- | :-- |
| Aggiornamento di Astro e dell'adapter Node | Vulnerabilità note, tra cui una critica nell'ottimizzazione immagini e un crash del server con header `Host` malformato |
| Blocco di `/_image`, `/_server-islands`, `/_actions` | Endpoint del framework non usati dal sito ma presenti nel bundle |
| Allowlist dei metodi HTTP e del corpo delle richieste | Riduce ciò che può raggiungere l'applicazione |
| IP del client solo da proxy verificati | Il rate limit era aggirabile cambiando un header |
| Rate limiter a memoria limitata + tetto globale di invii | Evita crescita incontrollata della memoria e flooding della casella |
| Limite reale alla lettura del corpo (16 KB) | Prima `request.json()` leggeva corpi di qualsiasi dimensione |
| Pagina 404 propria | Quella di default rivelava il framework |
| Risposta di Turnstile validata; controllo dell'hostname | Un token ottenuto su un altro sito non deve valere qui |
| Niente `node_modules` né `npm` nell'immagine; base Alpine | Meno codice, meno vulnerabilità da inseguire |
| `docker-compose.yml`: porta di sviluppo solo su `127.0.0.1` | Il server di sviluppo non deve essere visibile sulla rete locale |
| `/.well-known/security.txt` (RFC 9116) | Canale dichiarato per le segnalazioni di vulnerabilità |
| Dependabot (npm, Docker, Actions) | Le correzioni arrivano come pull request |

---

## 11. Checklist operativa (fuori dal repository)

Azioni che il codice non può compiere. Finché restano aperte, la protezione corrispondente non è attiva.

**Cloudflare**

- [ ] Dominio proxato (nuvola arancione) per `nztsolutions.it` e `www`.
- [ ] SSL/TLS in modalità **Full**. Railway dichiara che con il proxy attivo _Full (Strict)_ non funziona
      come previsto; _Flexible_ è vietato.
- [ ] **Minimum TLS Version: 1.3**, "Always Use HTTPS" attivo.
- [ ] **Transform Rule** (Modify Request Header): imposta `X-Origin-Verify` al valore generato con
      `openssl rand -hex 32`, per tutte le richieste.
- [ ] WAF: regola di rate limiting su `/api/contact` (es. 10 richieste/minuto per IP) e Bot Fight Mode.
- [ ] Widget Turnstile limitato agli hostname `nztsolutions.it` e `www.nztsolutions.it`.
- [ ] **DNSSEC** attivo (record DS inserito presso il registrar).
- [ ] Record **CAA**. Railway emette con Let's Encrypt; Cloudflare usa anche altre CA per i certificati al
      bordo e, con Universal SSL, aggiunge da sé i propri record CAA quando ne esiste almeno uno. Verificare
      con `dig CAA nztsolutions.it` che le CA di Cloudflare restino ammesse prima di restringere:
      ```text
      nztsolutions.it. IN CAA 0 issue "letsencrypt.org"
      nztsolutions.it. IN CAA 0 issuewild ";"
      ```

**Railway**

- [ ] Variables impostate (tabella di [§7](#7-pipeline-cicd-e-secrets-management---)), in particolare `ORIGIN_VERIFY_SECRET` **dopo** aver
      creato la Transform Rule, altrimenti il sito risponde `403` a tutti.
- [ ] `PUBLIC_TURNSTILE_SITE_KEY` presente: con il build da Dockerfile viene passata come build argument.
- [ ] Una sola replica, finché il rate limit è in memoria ([§3.4](#34-rate-limiting)).
- [ ] Primo deploy dopo il passaggio a Dockerfile: seguire il build e controllare nei log l'evento
      `server_started` con `originVerification: true`.
- [ ] Quando arriveranno i database: nessun _Public TCP Proxy_ ([§1.1](#11-isolamento-rete-railway-zero-public-db--)).

**Email (Resend / DNS)**

- [ ] Dominio mittente verificato su Resend con SPF e DKIM.
- [ ] Record **DMARC** (`p=quarantine` o `reject`) per impedire l'uso del dominio in email contraffatte.
- [ ] Chiave API Resend con permesso di solo invio, ristretta al dominio.

**GitHub**

- [ ] Protezione del branch `main`: pull request obbligatoria e workflow `Security` come controllo richiesto.
- [ ] Secret scanning con push protection e avvisi Dependabot attivi.

**Scadenze**

- [ ] `public/.well-known/security.txt`: campo `Expires` da rinnovare entro il **2027-11-15**.
- [ ] Rotazione di `ORIGIN_VERIFY_SECRET`, `RESEND_API_KEY`, `TURNSTILE_SECRET_KEY` almeno annuale e a ogni
      sospetto di esposizione.

---

## 12. Rischi residui e decisioni aperte

| Tema | Stato | Nota |
| :-- | :-- | :-- |
| HSTS con `includeSubDomains; preload` | Applicato come da blueprint | Vale per **tutti** i sottodomini di `nztsolutions.it`: un sottodominio servito solo in HTTP smette di funzionare nei browser che hanno visitato il sito. L'iscrizione alla lista di preload (hstspreload.org) è un passo separato, volontario e difficile da annullare |
| `style-src-attr 'unsafe-inline'` | Accettato | Richiesto da React SSR, GSAP e Three.js. Non consente l'esecuzione di script |
| Tratto Cloudflare → Railway | Accettato | In modalità _Full_ Cloudflare cifra ma non valida il certificato dell'origine; mTLS non è realizzabile su Railway. Compensato dall'header segreto |
| Rate limit in memoria | Accettato con vincolo | Una sola istanza; si azzera a ogni riavvio. Compensato da Turnstile e dal rate limiting di Cloudflare |
| Invio email riuscito | Non collaudato | Il flusso è stato provato fino alla risposta di Resend con una chiave non valida (rifiuto atteso); l'invio vero va confermato in produzione con la chiave reale |
| Vulnerabilità nelle dipendenze di sviluppo | Monitorato | `pnpm audit` segnala 1 media (`minimatch`, via `typescript-eslint`) e 1 bassa (`esbuild`, solo dev server su Windows): non entrano nell'immagine di produzione |
| Pagine legali | Aperto | `privacy-policy` e `cookie-policy` sono segnaposto: prima della messa online devono dichiarare l'uso di Cloudflare Turnstile e Resend e il trattamento dei log |
| Monitoraggio continuo | Aperto | Railway esegue l'healthcheck solo al deploy: valutare un controllo di uptime esterno su `/healthz` e un avviso sugli eventi `error` |

---

## 13. Come verificare

```bash
pnpm install --frozen-lockfile
pnpm lint                  # ESLint
pnpm build                 # astro check + build + calcolo degli hash CSP
pnpm test                  # test unitari e di integrazione (l'integrazione richiede il build)
pnpm audit --audit-level=high

# Server di produzione in locale
ORIGIN_VERIFY_SECRET=$(openssl rand -hex 32) PORT=8080 node server/index.mjs
curl -i http://127.0.0.1:8080/            # 403: manca il segreto
curl -i http://127.0.0.1:8080/healthz     # 200

# Container
docker build --build-arg PUBLIC_TURNSTILE_SITE_KEY=1x00000000000000000000AA -t nzt-web .
docker run --rm --read-only --cap-drop=ALL --security-opt no-new-privileges -p 127.0.0.1:8080:8080 nzt-web
```

Dopo il deploy: verificare gli header con <https://securityheaders.com> e la CSP con
<https://csp-evaluator.withgoogle.com>; controllare la console del browser su ogni pagina (nessuna
violazione CSP attesa).

---

## 14. Prompt operativo per Claude

_Copia e incolla il blocco sottostante per guidare Claude nello sviluppo delle feature:_

```text
Sei il Principal Security Engineer incaricato di implementare il software per questo stack.
Fai riferimento in modo vincolante al documento "docs/architettura_sicurezza_nzt_solutions.md".

Requisiti obbligatori per ogni frammento di codice che generi:
1. Adotta il modello Zero-Trust e il principio del minimo privilegio.
2. Ogni endpoint deve convalidare il payload con uno schema rigoroso che rifiuta le chiavi extra:
   Pydantic v2 con extra="forbid" in FastAPI, z.strictObject (da "@/lib/zod") nelle rotte Astro.
3. Le query al database non devono contenere stringhe concatenate: usa solo SQLAlchemy 2.0 parametrizzato o filtri MongoDB tipizzati contro NoSQL injection.
4. I token di sessione devono essere emessi esclusivamente tramite cookie HttpOnly, Secure, SameSite=Lax. Nessun token in localStorage.
5. Inserisci sempre controlli di ownership espliciti (Order.user_id == current_user.id) per scongiurare falle BOLA/IDOR.
6. Il codice frontend Astro deve rispettare la CSP (nessuno script inline non coperto da hash, nessuna nuova origine esterna non dichiarata), con checkOrigin attivo e sanitizzazione su markup HTML dinamico.
7. Produci codice direttamente eseguibile, tipizzato (Python typing / TypeScript strict) e corredato da test di sicurezza unitari.
8. A lavoro concluso aggiorna il documento di architettura di sicurezza: sezione interessata, tabella di stato (§0.2) e registro delle modifiche (§15).
```

---

## 15. Registro delle modifiche

| Data | Modifica |
| :-- | :-- |
| 2026-11-18 | **Area Clienti: database da PostgreSQL a MongoDB esterno** (decisione: un solo servizio database condiviso tra i servizi NZT). §1.1: regola di isolamento per un cluster esterno (database per servizio, IP Access List, TLS verificato obbligatorio). §3.2 scenario B applicato. Dettagli nel documento dell'Area Clienti (§5, §9, §16, §24.2). |
| 2026-11-15 | **Prima stesura e prima applicazione del blueprint.** Perimetro di produzione `server/index.mjs` (verifica dell'origine, allowlist di metodi e path, limiti sul corpo, IP da proxy verificati). Security header e CSP a hash su ogni risposta. API contatti: schema strict, controllo stessa origine, rate limiter a memoria limitata con tetto globale, log JSON senza dati personali. Aggiornamento Astro 5 → 7 e dipendenze vulnerabili; rimozione dell'SDK Resend. Container multi-stage non-root su Alpine senza `node_modules`. Pipeline `Security` (Gitleaks, audit, test, Trivy), Dependabot, hook pre-commit. Pagina 404, `security.txt`. 111 test di sicurezza. |
