# NZT Solutions — Documento di Architettura Tecnica (v1.0)

> **Progetto:** Sito Web Ufficiale & Landing Page Ad Alte Prestazioni (`nztsolutions.it`)  
> **Modello Architetturale:** Struttura Disaccoppiata (Astro SSG + React Islands) predisposta per futura Area Clienti (`clienti.nztsolutions.it`)  
> **Riferimento Estetico/Funzionale:** Paradigma *pnote.it* (Mockup UI interattivi nel DOM, animazioni fluide controllate, zero impatto SEO)

---

## 1. Visione e Principi Architetturali

L'architettura di **NZT Solutions** è progettata attorno a quattro pilastri non negoziabili:

1. **Zero-JS di Default (HTML First):** L'intera struttura semantica, i testi commerciali, le intestazioni (`h1-h6`) e le sezioni statiche vengono compilati in HTML/CSS puro in fase di build. I crawler di Google ricevono il contenuto completo istantaneamente senza dover eseguire JavaScript.
2. **Idratazione Selettiva ad Isole (Islands Architecture):** Il codice JavaScript (React, Motion, 3D) viene scaricato ed eseguito **solo** per i singoli componenti interattivi e **solo** quando l'utente scorre fino a renderli visibili (`client:visible`) o quando il thread principale del browser è libero (`client:idle`).
3. **Mockup UI nel DOM invece di Video/GIF:** Come su *pnote.it*, le dimostrazioni dei servizi e dei software di NZT Solutions non useranno file video pesanti, ma componenti HTML/CSS/React animati che simulano dashboard, notifiche, flussi di lavoro e grafici interattivi. Questo garantisce nitidezza vettoriale su ogni schermo, peso inferiore a pochi kilobyte e testo indicizzabile.
4. **Design System Condivisibile (Future-Proof):** Tutti i componenti atomici dell'interfaccia (bottoni, badge, input, card, modali, token di colore) sono scritti in **React + Tailwind CSS** e isolati in una cartella dedicata (`src/components/ui`). Quando nascerà l'Area Clienti (`clienti.nztsolutions.it`), l'intero sistema grafico potrà essere riutilizzato al 100% senza riscrivere una riga di codice.

### Target Prestazionali (Performance Budget)
* **Google PageSpeed Insights (Mobile & Desktop):** $98 - 100 / 100$
* **LCP (Largest Contentful Paint):** $< 1.2\text{ s}$
* **INP (Interaction to Next Paint):** $< 80\text{ ms}$
* **CLS (Cumulative Layout Shift):** $0.00$
* **TTFB (Time to First Byte su CDN):** $< 50\text{ ms}$
* **Peso iniziale JS (First Load):** $< 35\text{ KB}$ (gzipped)

---

## 2. Stack Tecnologico Completo

### 2.1 Core & Frontend
| Livello | Tecnologia | Versione | Ruolo nel Progetto |
| :--- | :--- | :--- | :--- |
| **Package Manager** | **pnpm** | `9.x+` | Gestione dipendenze veloce e pronto per un futuro Monorepo (`pnpm workspaces`). |
| **Meta-Framework** | **Astro** | `5.x` | Generatore statico (SSG), gestione routing, ottimizzazione asset, SEO e architettura a isole. |
| **UI Library (Isole)** | **React** | `19.x` | Costruzione dei mockup interattivi (dashboard demo, tab switcher, configuratori, form). |
| **Linguaggio** | **TypeScript** | `5.x` | Tipizzazione statica (`strict: true`) per prevenire bug e documentare le props dei componenti. |
| **Styling Engine** | **Tailwind CSS** | `4.x` | Utility-first CSS con variabili CSS native per il tema e purge automatico del CSS inutilizzato. |
| **Component Utilities** | **CVA + tailwind-merge** | Latest | Creazione di varianti di componenti UI riutilizzabili (stile *shadcn/ui*). |

### 2.2 Motore di Animazione & Interattività
| Libreria | Ruolo Specifico | Strategia di Caricamento |
| :--- | :--- | :--- |
| **GSAP + ScrollTrigger** | Animazioni legate allo scroll, testo che si rivela, sezioni fissate (*pinning*), timeline complesse. | Caricato in modo asincrono dopo il `DOMContentLoaded`. |
| **Lenis (`lenis`)** | *Smooth scrolling* morbido e moderno sincronizzato con il ticker di GSAP. | Disattivato automaticamente su touch/mobile e se `prefers-reduced-motion` è attivo. |
| **Motion (`motion/react`)** | Micro-interazioni interne alle isole React (transizioni tra tab, comparsa notifiche simulate, layout animations). | Incluso solo nelle isole React con direttiva `client:visible`. |
| **Spline / Three.js** *(Opzionale)* | Elemento 3D interattivo nella Hero o in sezione dedicata (con pulsante *"Attiva/Pausa 3D"* come su *pnote.it*). | Caricato esclusivamente *on-demand* (`client:idle` o al click dell'utente). |

### 2.3 Form, SEO, Icone e Infrastruttura
* **Iconografia:** `lucide-react` (per le isole React) + `@astro-icon` (SVG puri inline a zero JS per le parti statiche).
* **Tipografia:** `@fontsource` (font ospitati localmente nel progetto in formato `.woff2` con `font-display: swap` per azzerare le chiamate verso Google Fonts e garantire CLS pari a zero).
* **Gestione Form Contatti:** `react-hook-form` + `zod` (validazione schema rigorosa) + **Astro Actions / Serverless Endpoint** integrato con **Resend** per l'invio email transazionale.
* **SEO & Dati Strutturati:** `@astrojs/sitemap`, metadati OpenGraph nativi e iniezione automatica di schemi **JSON-LD** (`Organization`, `WebSite`, `Service`, `FAQPage`).
* **Hosting & Edge CDN:** **Cloudflare Pages** oppure **Vercel** (deploy automatico ad ogni `git push` sul branch `main`).

---

## 3. Configurazione `package.json` di Riferimento

Questo è il manifesto completo delle dipendenze con cui inizializzare il repository:

```json
{
  "name": "nzt-solutions-web",
  "type": "module",
  "version": "1.0.0",
  "private": true,
  "scripts": {
    "dev": "astro dev",
    "start": "astro dev",
    "build": "astro check && astro build",
    "preview": "astro preview",
    "astro": "astro",
    "lint": "eslint . --ext .js,.ts,.tsx,.astro",
    "format": "prettier --write ."
  },
  "dependencies": {
    "@astrojs/react": "^4.2.0",
    "@astrojs/sitemap": "^3.2.0",
    "@hookform/resolvers": "^3.9.0",
    "@tailwindcss/vite": "^4.0.0",
    "astro": "^5.1.0",
    "class-variance-authority": "^0.7.1",
    "clsx": "^2.1.1",
    "gsap": "^3.12.5",
    "lenis": "^1.1.18",
    "lucide-react": "^0.468.0",
    "motion": "^11.15.0",
    " nanostores": "^0.11.3",
    "@nanostores/react": "^0.7.3",
    "react": "^19.0.0",
    "react-dom": "^19.0.0",
    "react-hook-form": "^7.54.0",
    "resend": "^4.0.0",
    "tailwind-merge": "^2.5.5",
    "tailwindcss": "^4.0.0",
    "zod": "^3.24.1"
  },
  "devDependencies": {
    "@astrojs/check": "^0.9.4",
    "@types/react": "^19.0.0",
    "@types/react-dom": "^19.0.0",
    "prettier": "^3.4.2",
    "prettier-plugin-astro": "^0.14.1",
    "prettier-plugin-tailwindcss": "^0.6.9",
    "typescript": "^5.7.2"
  }
}
```

---

## 4. Struttura delle Cartelle (File Tree Completo)

La struttura è organizzata per separare nettamente:
1. **`components/ui/`**: Il Design System atomico in React (pronto per essere condiviso con la futura Area Clienti).
2. **`components/interactive/`**: Le "Isole" interattive stile *pnote.it* (mockup animati, simulazioni software, form).
3. **`components/sections/`**: Le sezioni principali della Landing Page in formato `.astro` (statiche, SEO-first).

```text
nzt-solutions-web/
├── public/
│   ├── fonts/                        # Font custom .woff2 (se non su Fontsource)
│   ├── favicons/                     # Favicon SVG, Apple Touch Icon, manifest
│   ├── og-image.jpg                  # Immagine OpenGraph 1200x630 per condivisione social
│   └── robots.txt                    # Direttive per i crawler e link alla sitemap
│
├── src/
│   ├── assets/                       # Immagini ottimizzate da Astro (convertite in AVIF/WebP)
│   │   ├── images/
│   │   └── logos/
│   │
│   ├── components/
│   │   ├── ui/                       # [RIUTILIZZABILI NELL'AREA CLIENTI] Componenti React puri
│   │   │   ├── Button.tsx            # Bottone con varianti CVA (primary, secondary, ghost, glow)
│   │   │   ├── Badge.tsx             # Pillole e tag di stato
│   │   │   ├── Card.tsx              # Contenitore base con effetti spotlight/bordo luminoso
│   │   │   ├── Input.tsx             # Campi di testo accessibili
│   │   │   └── AnimationToggle.tsx   # Switch "Pausa/Attiva Animazioni" (stile pnote.it)
│   │   │
│   │   ├── interactive/              # [ISOLE REACT] Mockup UI interattivi nel DOM
│   │   │   ├── HeroInteractiveMockup.tsx   # Simulazione live del flusso NZT Solutions nella Hero
│   │   │   ├── ServicesBentoTabs.tsx       # Bento Grid interattiva con cambio tab e micro-animazioni
│   │   │   ├── WorkflowSimulator.tsx       # Demo interattiva "Come lavoriamo" passo-passo
│   │   │   ├── RoiCalculator.tsx           # (Opzionale) Piccolo simulatore interattivo di benefici
│   │   │   ├── FaqAccordion.tsx            # Accordion animato fluido
│   │   │   └── ContactForm.tsx             # Modulo contatti validato con Zod + stato di invio
│   │   │
│   │   ├── sections/                 # [ASTRO STATICO - 0 KB JS] Sezioni della Landing Page
│   │   │   ├── Navbar.astro          # Header fisso con blur backdrop e CTA
│   │   │   ├── HeroSection.astro     # H1 SEO, sottotitolo, CTA + Isola HeroInteractiveMockup
│   │   │   ├── TrustBar.astro        # Loghi partner / tecnologie / numeri chiave
│   │   │   ├── ProblemSolution.astro # Confronto "Prima / Dopo NZT Solutions" animato con GSAP
│   │   │   ├── ServicesSection.astro # Sezione servizi con Bento Grid e Mockup DOM
│   │   │   ├── MethodSection.astro   # Processo di lavoro con pinning allo scroll
│   │   │   ├── FaqSection.astro      # Domande frequenti con markup Schema.org FAQPage
│   │   │   ├── CtaSection.astro      # Sezione di chiusura ad alta conversione + ContactForm
│   │   │   └── Footer.astro          # Link legali, P.IVA, contatti, toggle animazioni
│   │   │
│   │   └── seo/
│   │       ├── BaseHead.astro        # Meta tag, Canonical, OpenGraph, Twitter Cards
│   │       └── SchemaOrg.astro       # Generatore JSON-LD per Google Rich Snippets
│   │
│   ├── layouts/
│   │   └── MainLayout.astro          # guscio HTML, inizializzazione Lenis + GSAP e SEO
│   │
│   ├── lib/
│   │   ├── utils.ts                  # Funzione `cn()` (clsx + tailwind-merge)
│   │   ├── gsap-init.ts              # Setup centrale di GSAP ScrollTrigger + Lenis
│   │   └── stores/
│   │       └── uiStore.ts            # Nano Store per stato globale leggero (es. pausa animazioni, pacchetto selezionato)
│   │
│   ├── pages/
│   │   ├── index.astro               # Landing Page principale (nztsolutions.it/)
│   │   ├── privacy-policy.astro      # Pagina legale statica
│   │   ├── cookie-policy.astro       # Pagina legale statica
│   │   └── api/
│   │       └── contact.ts            # Endpoint per gestione invio form contatti
│   │
│   ├── content/                      # Dati tipizzati (testi servizi, FAQ, recensioni)
│   │   ├── services.ts
│   │   └── faqs.ts
│   │
│   └── styles/
│       └── global.css                # Import Tailwind v4, variabili colore tema, utility GPU
│
├── astro.config.mjs                  # Configurazione Astro + React + Tailwind + Sitemap
├── tsconfig.json                     # Configurazione TypeScript con path alias (@/*)
└── package.json
```

---

## 5. Architettura delle Isole e Strategia di Idratazione

Per ottenere lo stesso effetto scenografico di *pnote.it* senza appesantire il sito, ogni elemento della pagina segue una regola rigorosa di caricamento:

| Sezione della Pagina | Tipo Componente | Direttiva Astro | Peso JS al Caricamento Iniziale |
| :--- | :--- | :--- | :--- |
| **Navbar & Hero Testuale (H1, sottotitolo, CTA)** | `.astro` (Statico) | *Nessuna (HTML puro)* | **0 KB** (Renderizzato istantaneamente per LCP) |
| **Hero Mockup Interattivo / Scena 3D** | `.tsx` (React Island) | `client:idle` | Scaricato solo *dopo* che la pagina è già visibile e cliccabile |
| **Loghi & Numeri (TrustBar)** | `.astro` + CSS Marquee | *Nessuna (CSS puro)* | **0 KB** (Animazione gestita al 100% dalla GPU via CSS) |
| **Sezione Problema / Soluzione** | `.astro` + GSAP | Script differito | Minimo (Usa i nodi HTML già presenti nel DOM) |
| **Bento Grid Servizi Interattiva** | `.tsx` (React Island) | `client:visible` | **0 KB all'avvio** (Scaricato solo quando l'utente scorre vicino alla sezione) |
| **Simulatore Workflow / Demo** | `.tsx` (React Island) | `client:visible` | **0 KB all'avvio** |
| **FAQ Accordion** | `.tsx` o `<details>` nativo | `client:visible` | **0 KB all'avvio** (Il testo delle risposte è già nel DOM per Google) |
| **Modulo di Contatto** | `.tsx` (React Island) | `client:visible` | **0 KB all'avvio** |

### Come far comunicare due sezioni distanti (Stato Condiviso con Nano Stores)
Se l'utente clicca su *"Richiedi preventivo per Sviluppo Software"* nella Bento Grid a metà pagina e vuoi che il modulo di contatto in fondo si aggiorni automaticamente:

```typescript
// src/lib/stores/uiStore.ts
import { atom } from 'nanostores';

// 1. Stato per il servizio selezionato dall'utente (0.3 KB di libreria)
export const selectedServiceStore = atom<string>('generale');

// 2. Stato globale per mettere in pausa tutte le animazioni (stile pnote.it)
export const animationsPausedStore = atom<boolean>(false);
```
Qualsiasi isola React può leggere o aggiornare questo valore in tempo reale con `useStore(selectedServiceStore)` senza dover trasformare l'intera pagina in un'applicazione React monolitica.

---

## 6. Architettura del Motore di Animazione (GSAP + Lenis + Controllo Utente)

### 6.1 Inizializzazione Centrale (`src/lib/gsap-init.ts`)
Tutte le animazioni di scorrimento sono centralizzate, rispettano le impostazioni di accessibilità del sistema operativo (`prefers-reduced-motion`) e possono essere messe in pausa dall'utente (proprio come il controllo presente su *pnote.it*):

```typescript
// src/lib/gsap-init.ts
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import Lenis from 'lenis';
import { animationsPausedStore } from './stores/uiStore';

gsap.registerPlugin(ScrollTrigger);

export function initSmoothScrollAndAnimations() {
  const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (prefersReducedMotion) {
    animationsPausedStore.set(true);
    return;
  }

  // 1. Inizializza Lenis per lo smooth scroll
  const lenis = new Lenis({
    duration: 1.1,
    easing: (t) => Math.min(1, 1.001 - Math.pow(2, -10 * t)),
    smoothWheel: true,
  });

  // 2. Sincronizza Lenis con GSAP ScrollTrigger
  lenis.on('scroll', ScrollTrigger.update);
  gsap.ticker.add((time) => {
    lenis.raf(time * 1000);
  });
  gsap.ticker.lagSmoothing(0);

  // 3. Animazione automatica per tutti gli elementi con attributo [data-animate="fade-up"]
  const fadeElements = gsap.utils.toArray<HTMLElement>('[data-animate="fade-up"]');
  fadeElements.forEach((el) => {
    gsap.fromTo(
      el,
      { y: 32, opacity: 0 },
      {
        y: 0,
        opacity: 1,
        duration: 0.8,
        ease: 'power3.out',
        scrollTrigger: {
          trigger: el,
          start: 'top 85%',
          toggleActions: 'play none none none',
        },
      }
    );
  });

  // 4. Ascolta il toggle "Pausa Animazioni" dell'utente
  animationsPausedStore.subscribe((isPaused) => {
    if (isPaused) {
      lenis.stop();
      gsap.globalTimeline.pause();
    } else {
      lenis.start();
      gsap.globalTimeline.resume();
    }
  });
}
```

### 6.2 Regole Auree per le Animazioni (Anti-Penalizzazione SEO)
1. **Solo proprietà Composite (GPU):** Animare esclusivamente `transform` (`translate3d`, `scale`, `rotate`) e `opacity`.
2. **Vietato animare proprietà di Layout:** Non animare mai `top`, `left`, `width`, `height`, `margin` o `padding` durante lo scroll (causano *Reflow* e fanno crollare il punteggio INP e CLS).
3. **Visibilità SEO dei contenuti animati:** Non impostare `opacity: 0` statico nel CSS base se c'è il rischio che un crawler senza JS non veda l'elemento; usa un blocco `<noscript><style>[data-animate] { opacity: 1 !important; transform: none !important; }</style></noscript>` nel `<head>`.

---

## 7. Strategia SEO Tecnica e Dati Strutturati

Per garantire il massimo posizionamento organico fin dal lancio, il componente `SchemaOrg.astro` inietterà nel `<head>` il grafo JSON-LD completo:

* **`Organization` & `ProfessionalService`:** Nome ufficiale (*NZT Solutions*), logo, URL, contatti, area geografica servita e profili social.
* **`WebSite`:** Struttura principale del dominio `https://nztsolutions.it`.
* **`Service` (ItemList):** Elenco strutturato dei servizi offerti nella landing page (comprensibile anche dai motori di ricerca AI e da Google SGE).
* **`FAQPage`:** Generato automaticamente a partire dal file `src/content/faqs.ts` per ottenere spazio extra nei risultati di ricerca.

### Checklist SEO Pre-Renderizzata
* **Gerarchia Heading rigorosa:** Un solo `<h1>` nella Hero Section con la keyword principale di NZT Solutions; `<h2>` per ogni macro-sezione; `<h3>` per le singole card della Bento Grid.
* **Ottimizzazione Immagini Nativa:** Uso esclusivo del componente `<Image />` di `astro:assets` con conversione automatica in `AVIF` e `WebP`, attributi `width` e `height` espliciti (zero Layout Shift) e `loading="eager"` con `fetchpriority="high"` solo sull'elemento visivo principale della Hero.
* **Testo nei Mockup Interattivi:** Poiché le demo dei servizi sono costruite in HTML/React (come le card di chiamata e l'agenda su *pnote.it*) e pre-renderizzate sul server da Astro (SSR pass per i componenti client), Google legge anche i testi interni alle tue illustrazioni interattive.

---

## 8. File di Configurazione Chiave (Boilerplate di Partenza)

### 8.1 `astro.config.mjs`
```javascript
import { defineConfig } from 'astro/config';
import react from '@astrojs/react';
import sitemap from '@astrojs/sitemap';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  site: 'https://nztsolutions.it',
  output: 'static',
  integrations: [
    react(),
    sitemap({
      changefreq: 'weekly',
      priority: 1.0,
      lastmod: new Date(),
    }),
  ],
  vite: {
    plugins: [tailwindcss()],
    build: {
      cssMinify: 'lightningcss',
    },
  },
  prefetch: {
    prefetchAll: true,
    defaultStrategy: 'viewport',
  },
});
```

### 8.2 `tsconfig.json`
```json
{
  "extends": "astro/tsconfigs/strict",
  "compilerOptions": {
    "jsx": "react-jsx",
    "jsxImportSource": "react",
    "baseUrl": ".",
    "paths": {
      "@/*": ["./src/*"],
      "@ui/*": ["./src/components/ui/*"],
      "@interactive/*": ["./src/components/interactive/*"],
      "@sections/*": ["./src/components/sections/*"]
    }
  }
}
```

### 8.3 `src/styles/global.css` (Design Tokens & Tema)
```css
@import "tailwindcss";

@layer base {
  :root {
    --bg-primary: #07090e;
    --bg-surface: #0f1420;
    --bg-surface-elevated: #171f32;
    --text-primary: #f8fafc;
    --text-muted: #94a3b8;
    --accent-primary: #3b82f6;
    --accent-glow: rgba(59, 130, 246, 0.35);
    --border-subtle: rgba(255, 255, 255, 0.08);
  }

  html {
    background-color: var(--bg-primary);
    color: var(--text-primary);
    scroll-behavior: auto; /* Gestito da Lenis */
    -webkit-font-smoothing: antialiased;
  }
}

/* Utility per accelerazione hardware sulle card animate */
.gpu-accelerated {
  will-change: transform, opacity;
  transform: translateZ(0);
  backface-visibility: hidden;
}
```

---

## 9. Piano di Espansione Futura: Area Clienti (`clienti.nztsolutions.it`)

Questa architettura è stata progettata affinché l'aggiunta della futura Area Clienti avvenga a **costo di refactoring zero**.

### Fase 1 (Oggi): Repository Singolo per la Landing Page
* Il sito vive su `nztsolutions.it` ed è distribuito gratuitamente su Edge CDN (Cloudflare Pages o Vercel).
* Tutti i bottoni, badge, input e card vengono creati dentro `src/components/ui/` usando solo React e Tailwind (senza dipendenze specifiche di Astro).

### Fase 2 (Futuro): Creazione di `clienti.nztsolutions.it`
Quando deciderai di aprire l'Area Clienti, avrai due opzioni immediate:
1. **Condivisione immediata del Design System (Monorepo `pnpm workspaces`):**
   * Sposti la cartella `src/components/ui` in un pacchetto condiviso `packages/ui`.
   * Sia la landing (`apps/landing` in Astro) sia il portale clienti (`apps/portal` in Next.js o React Vite) importano esattamente gli stessi componenti (`import { Button, Card } from '@nzt/ui'`).
2. **Configurazione DNS (Zero costi di dominio):**
   * Nel pannello DNS di `nztsolutions.it`, mantieni il record principale `@` puntato alla CDN della landing page.
   * Aggiungi un singolo record `CNAME` per `clienti` che punta all'applicazione dell'Area Clienti.
   * Nella Navbar della landing page ti basterà attivare il pulsante **"Area Clienti"** che punta a `https://clienti.nztsolutions.it`.

---

## 10. Roadmap Operativa di Sviluppo (Step-by-Step)

1. **Step 1 — Bootstrap del Progetto:**
   * Eseguire `pnpm create astro@latest nzt-solutions-web` (template vuoto, TypeScript `strict`).
   * Installare le dipendenze del `package.json` definito nella Sezione 3.
2. **Step 2 — Setup Design System & Layout Base:**
   * Configurare i font locali, la palette colori in `global.css`, `MainLayout.astro`, `BaseHead.astro` e i componenti base in `src/components/ui/` (`Button.tsx`, `Card.tsx`, `Badge.tsx`).
3. **Step 3 — Sviluppo Struttura Statica SEO (Scheletro HTML):**
   * Costruire tutte le sezioni `.astro` (`Navbar`, `HeroSection`, `ServicesSection`, `MethodSection`, `FaqSection`, `Footer`) con i testi definitivi e i tag semantici corretti. Verificare il punteggio Lighthouse 100/100.
4. **Step 4 — Sviluppo Mockup Interattivi (Stile *pnote.it*):**
   * Creare le isole React in `src/components/interactive/`: il mockup animato della Hero (`HeroInteractiveMockup.tsx`) e la Bento Grid dei servizi con micro-interazioni in *Motion*.
5. **Step 5 — Integrazione GSAP + Lenis & Controllo Animazioni:**
   * Collegare `gsap-init.ts` per le rivelazioni allo scroll e inserire il pulsante *"Pausa/Attiva Animazioni"* per accessibilità e performance.
6. **Step 6 — Form di Contatto, SEO Finale e Deploy:**
   * Collegare `ContactForm.tsx` all'endpoint email, validare i dati strutturati JSON-LD e pubblicare su Cloudflare Pages / Vercel collegando il dominio `nztsolutions.it`.