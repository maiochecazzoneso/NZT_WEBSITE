// src/content/site.ts
// Dati globali e testi della Home (layout snello: Hero → Visione & Missione → Sistemi su misura →
// Prodotti → FAQ → Contatti). Copy: "Direttive di refactoring UI & Copy", ripulito secondo l'Audit
// anti-AI slop (niente antitesi "non X, ma Y", triplette meccaniche o promesse numeriche non dimostrabili).
// I dati societari mancanti sono marcati `// DA INSERIRE`.

export const site = {
  name: 'NZT Solutions',
  email: 'info@nztsolutions.it',
  // Area Clienti (Fase 2): sottodominio predisposto ma non ancora attivo
  clientAreaUrl: 'https://clienti.nztsolutions.it',
  pnoteUrl: 'https://pnote.it',
  tagline:
    'Ingegneria del software su misura, automazione dei processi e sistemi di Intelligenza Artificiale privata per imprese e studi professionali che vogliono lavorare al 100% del proprio potenziale.',
  legal: {
    vat: 'P.IVA [Da inserire]', // DA INSERIRE
    address: 'Sede Legale [Da inserire]', // DA INSERIRE
    pages: [
      { label: 'Privacy Policy', href: '/privacy-policy' },
      { label: 'Cookie Policy', href: '/cookie-policy' },
    ],
  },
} as const;

/** Meta description di default (Home) */
export const defaultDescription =
  'NZT Solutions progetta sistemi su misura, automazioni e Intelligenza Artificiale privata per PMI e studi professionali. La tua azienda ha già tutto per correre: togliamo ciò che la frena.';

// ---------------------------------------------------------------------------
// Servizi selezionabili nel form (selectedServiceStore di Nano Stores)
// ---------------------------------------------------------------------------
export const serviceOptions = [
  { value: 'generale', label: 'Voglio fare un’analisi generale dei flussi della mia azienda' },
  { value: 'software-custom', label: 'Sviluppo Software su Misura / Web App Proprietaria' },
  { value: 'automazione-ai', label: 'Automazione Uffici & Intelligenza Artificiale nei Processi' },
  { value: 'consulenza-ai', label: 'Audit Tecnico & Studio di Fattibilità AI' },
  { value: 'nzt-enterprise', label: 'Prodotto: NZT Enterprise (Ricerca Documentale AI in Locale)' },
  { value: 'voicebot-b2b', label: 'Prodotto: Pnote / Soluzioni Voicebot AI Telefoniche' },
] as const;

export type ServiceId = (typeof serviceOptions)[number]['value'];

// ---------------------------------------------------------------------------
// Hero: solo H1 + 2 CTA (le particelle compongono la scritta di transizione)
// ---------------------------------------------------------------------------
export const hero = {
  // Due righe brevi composte dalle particelle 3D (l'isola misura il testo reale: righe separate da <br />)
  particleLines: ['Zero Attrito', 'Operativo'],
  title: 'La tua azienda ha già tutto per correre. Noi togliamo ciò che la frena.',
  primaryCta: { label: 'Parla con un nostro ingegnere', href: '/#contatti' },
  secondaryCta: { label: 'Esplora Sistemi e Prodotti', href: '/#sistemi' },
  scrollHint: 'Scorri nei sistemi ↓',
};

// ---------------------------------------------------------------------------
// Visione & Missione (2 card, nessuna intestazione di sezione)
// ---------------------------------------------------------------------------
export const visionMission = [
  {
    label: '01 · Vision',
    title: 'Sbloccare il 100% del potenziale della tua azienda.',
    text: 'Ogni impresa ha già dentro di sé le competenze e i dati per correre, ma usa solo una frazione della propria forza perché è frenata da lavoro manuale e programmi rigidi. Il nostro scopo è togliere questo freno e azzerare la distanza tra ciò che la tua azienda vale e ciò che riesce a produrre ogni giorno.',
  },
  {
    label: '02 · Mission',
    title: 'Portare innovazione avanzata, semplice da usare.',
    text: 'Cerchiamo le automazioni e i sistemi di Intelligenza Artificiale che molte aziende ancora non conoscono e li portiamo dentro i loro flussi di lavoro. La complessità ingegneristica resta nel nostro codice: al tuo team arrivano strumenti da usare dal primo giorno, che tolgono ore di lavoro manuale ogni settimana.',
  },
];

// ---------------------------------------------------------------------------
// Sistemi su misura & White-Label (colonna sinistra sticky + 4 card)
// ---------------------------------------------------------------------------
export const customSystems = {
  badge: 'Sistemi personalizzati & White-Label',
  title: 'Hai un problema operativo? Costruiamo il sistema che lo risolve.',
  text: 'Se la tua azienda o il tuo studio ha un blocco specifico, progettiamo e scriviamo il software o l’automazione che lo risolve, sulle tue regole e con il tuo marchio.',
  cta: { label: 'Parla del tuo progetto con un tecnico', href: '/#contatti' },
  steps: [
    {
      title: 'Call Tecnica & Analisi dei Requisiti',
      text: 'Partiamo da una chiamata diretta con un ingegnere: ci racconti dove si blocca il lavoro e guardiamo come si muovono oggi le pratiche nei tuoi uffici. Alla fine della fase i requisiti del sistema sono scritti nero su bianco.',
    },
    {
      title: 'Scrittura del Sistema Su Misura',
      text: 'Scriviamo da zero il codice dell’applicativo web o dell’automazione AI, con dentro solo le funzioni che i tuoi flussi usano davvero. Nome, logo e colori sono quelli della tua azienda.',
    },
    {
      title: 'Installazione & Integrazione in Azienda',
      text: 'Installiamo il sistema sui tuoi server o sul tuo cloud privato e lo colleghiamo ai programmi che usi già (gestionali, ERP, email), senza mai interrompere il lavoro quotidiano.',
    },
    {
      title: 'Formazione Pratica del Personale',
      text: 'Un software funziona solo se chi lavora in ufficio lo usa volentieri. Affianchiamo il tuo team passo dopo passo, finché il nuovo strumento diventa un’abitudine per tutti.',
    },
  ],
};

// ---------------------------------------------------------------------------
// Intestazioni di sezione
// ---------------------------------------------------------------------------
export interface SectionCopy {
  eyebrow: string;
  title: string;
  lead: string;
}

export const sectionCopy = {
  products: {
    eyebrow: 'Soluzioni proprietarie pronte all’uso',
    title: 'Sistemi nati dalla nostra ricerca, pronti per la tua impresa.',
    lead: 'Oltre ai progetti su misura, abbiamo sviluppato due tecnologie verticali già pronte da installare.',
  },
  faq: {
    eyebrow: 'Domande frequenti',
    title: 'Tutto quello che è giusto chiarire prima di iniziare.',
    lead: 'Hai un caso specifico? Il primo colloquio tecnico serve proprio a questo.',
  },
  cta: {
    eyebrow: 'Contatta NZT Solutions',
    title: 'Sblocca il 100% della capacità operativa della tua azienda.',
    lead: 'Che tu voglia costruire un sistema su misura, automatizzare un flusso d’ufficio o installare NZT Enterprise nel tuo studio, parla direttamente con chi scriverà il tuo codice.',
  },
} satisfies Record<string, SectionCopy>;

// ---------------------------------------------------------------------------
// Blocco contatti e form
// ---------------------------------------------------------------------------
export const contactInfo = [
  {
    label: 'Primo confronto',
    text: 'Gratuito, diretto con un nostro ingegnere. Niente filtri commerciali.',
  },
];

export const contactFormCopy = {
  companyLabel: 'Azienda o Studio Professionale',
  phoneHint: 'opzionale, se preferisci un contatto rapido',
  serviceLabel: 'Su cosa vuoi intervenire?',
  messageLabel: 'Raccontaci in breve lo scenario',
  messagePlaceholder:
    'Es. “Perdiamo 3 ore al giorno a caricare ordini PDF sul gestionale…” oppure “Vorremmo unificare il calcolo commesse…”',
  submitLabel: 'Richiedi il Confronto Tecnico →',
};
