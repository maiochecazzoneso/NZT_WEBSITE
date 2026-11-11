// src/content/site.ts
// Dati globali, navigazione e testi di sezione della Home aziendale.
// Fonte: docs "Specifica Contenuti, Copywriting e Struttura Pagine" (§2, §3, §5).
// I dati societari mancanti sono marcati `// DA INSERIRE`.

export const site = {
  name: 'NZT Solutions',
  email: 'info@nztsolutions.it',
  // Area Clienti (Fase 2): sottodominio predisposto ma non ancora attivo
  clientAreaUrl: 'https://clienti.nztsolutions.it',
  pnoteUrl: 'https://pnote.it',
  tagline:
    'Sviluppo software personalizzato, automazione dei flussi di lavoro aziendali e sistemi di Intelligenza Artificiale proprietari.',
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
  'NZT Solutions progetta software su misura, automazioni dei flussi di lavoro con l’AI e sistemi di Intelligenza Artificiale privata per PMI e studi professionali. Ingegneria italiana, contatto diretto con chi scrive il codice.';

// ---------------------------------------------------------------------------
// Navigazione (§2.2). Href assoluti "/#…": funzionano dalla Home (Lenis li intercetta) e dalle sottopagine.
// ---------------------------------------------------------------------------
export interface NavChild {
  label: string;
  href: string;
  description: string;
  external?: boolean;
}

export interface NavLink {
  label: string;
  href: string;
  children?: NavChild[];
}

export const navLinks: NavLink[] = [
  { label: 'Chi Siamo & Visione', href: '/#visione' },
  { label: 'Servizi B2B', href: '/#servizi' },
  {
    label: 'Prodotti Proprietari',
    href: '/#prodotti',
    children: [
      {
        label: 'NZT Enterprise',
        href: '/nzt-enterprise',
        description: 'Sistema RAG documentale in locale con crittografia dei dati personali',
      },
      {
        label: 'Pnote Voice AI',
        href: site.pnoteUrl,
        description: 'Voicebot neurale per le prenotazioni dei ristoranti',
        external: true,
      },
    ],
  },
  { label: 'Metodo', href: '/#metodo' },
  { label: 'FAQ', href: '/#faq' },
];

export const primaryCta = { label: 'Parla con Noi', href: '/#contatti' };

// ---------------------------------------------------------------------------
// Servizi selezionabili nel form (selectedServiceStore di Nano Stores, §3 Sezione 8)
// ---------------------------------------------------------------------------
export const serviceOptions = [
  { value: 'generale', label: 'Consulenza Generale / Non so ancora da dove partire' },
  { value: 'software-custom', label: 'Sviluppo Software Personalizzato / Web App' },
  { value: 'automazione-ai', label: 'Automazione Flussi di Lavoro & AI in Azienda' },
  { value: 'consulenza-ai', label: 'Consulenza Tecnica & Audit AI' },
  { value: 'nzt-enterprise', label: 'Prodotto: NZT Enterprise (Sistema RAG Documentale Locale)' },
  { value: 'voicebot-b2b', label: 'Prodotto: Soluzioni Voicebot AI su misura' },
] as const;

export type ServiceId = (typeof serviceOptions)[number]['value'];

// ---------------------------------------------------------------------------
// Hero (§3 Sezione 1)
// ---------------------------------------------------------------------------
export const hero = {
  badge: 'NZT Solutions • Ingegneria del Software & Automazione AI',
  // Due righe brevi composte dalle particelle 3D (l'isola misura il testo reale: righe separate da <br />)
  particleLines: ['Zero Attrito', 'Operativo'],
  title: 'Progettiamo il software e le automazioni che fanno scorrere il lavoro della tua azienda.',
  subtitle:
    'I programmi standard ti costringono ad adattare la tua azienda ai loro limiti. Noi facciamo l’opposto: entriamo nei tuoi flussi operativi, eliminiamo i passaggi manuali e costruiamo software su misura e sistemi di Intelligenza Artificiale integrati nel tuo business.',
  primaryCta: { label: 'Richiedi una Consulenza Tecnica', href: '/#contatti' },
  secondaryCta: { label: 'Esplora Servizi e Prodotti', href: '/#servizi' },
};

// Control Room (HeroInteractiveMockup.tsx): blocco subito dopo la Hero
export const controlRoom = {
  eyebrow: 'Control Room NZT Solutions · Simulazione',
  title: 'Tre sistemi che costruiamo, osservati mentre lavorano.',
};

// ---------------------------------------------------------------------------
// TrustBar (§3 Sezione 2)
// ---------------------------------------------------------------------------
export const trustPillars = [
  {
    title: 'Architetture 100% Su Misura',
    text: 'Zero template preconfezionati o codice superfluo',
  },
  {
    title: 'Automazione End-to-End',
    text: 'Connessione nativa tra i software che usi già',
  },
  {
    title: 'AI Privata & Sicura',
    text: 'Sistemi progettati per proteggere il segreto aziendale',
  },
  {
    title: 'Ingegneria Italiana',
    text: 'Contatto diretto con chi scrive il codice, senza intermediari',
  },
];

// ---------------------------------------------------------------------------
// Intestazioni di sezione
// ---------------------------------------------------------------------------
export interface SectionCopy {
  eyebrow: string;
  title: string;
  lead: string;
}

export const sectionCopy = {
  vision: {
    eyebrow: 'Perché esiste NZT Solutions',
    title: 'La tecnologia dovrebbe togliere lavoro alle persone, non aggiungerne altro.',
    lead: 'In troppe aziende il personale qualificato passa ore a fare da “ponte umano” tra programmi che non si parlano: copiare dati da un PDF a un gestionale, rincorrere informazioni sparse in mille cartelle, controllare a mano errori di trascrizione. Noi interveniamo esattamente qui.',
  },
  services: {
    eyebrow: 'Servizi B2B & Ingegneria',
    title: 'Come trasformiamo l’operatività della tua azienda.',
    lead: 'Affianchiamo le imprese in tre ambiti fondamentali: dalla strategia tecnologica alla scrittura di piattaforme software complete.',
  },
  products: {
    eyebrow: 'La nostra ricerca diventa prodotto',
    title: 'Soluzioni proprietarie firmate NZT Solutions.',
    lead: 'Dalle esigenze reali delle imprese abbiamo sviluppato due tecnologie verticali pronte all’uso. Clicca sulla scheda di tuo interesse per approfondire.',
  },
  method: {
    eyebrow: 'Il metodo NZT Solutions',
    title: 'Come portiamo un progetto dall’idea alla produzione.',
    lead: 'Un approccio rigoroso in 4 fasi per garantirti tempi certi, zero interruzioni del tuo lavoro quotidiano e software che fa esattamente ciò che serve.',
  },
  faq: {
    eyebrow: 'Domande frequenti',
    title: 'Quello che le aziende ci chiedono prima di iniziare.',
    lead: 'Se la tua domanda non è qui, il primo colloquio tecnico serve proprio a questo.',
  },
  cta: {
    eyebrow: 'Contatta NZT Solutions',
    title: 'Costruiamo insieme il tuo prossimo vantaggio tecnologico.',
    lead: 'Che tu voglia progettare un software su misura, automatizzare un flusso di lavoro con l’AI o installare NZT Enterprise nel tuo studio, parla direttamente con i nostri ingegneri.',
  },
} satisfies Record<string, SectionCopy>;

// ---------------------------------------------------------------------------
// Confronto (§3 Sezione 3)
// ---------------------------------------------------------------------------
export interface ComparisonPoint {
  title: string;
  text: string;
}

export const comparison = {
  traditional: {
    badge: 'Il modello tradizionale',
    title: 'Software rigidi e lavoro manuale',
    points: [
      {
        title: 'Processi frammentati',
        text: 'Usi 5 software diversi (CRM, fatturazione, fogli Excel, email, portali) e nessuno comunica in automatico con l’altro.',
      },
      {
        title: 'Colli di bottiglia operativi',
        text: 'Se il volume di lavoro raddoppia, sei costretto ad aumentare le ore di lavoro manuale per gestire la burocrazia interna.',
      },
      {
        title: 'Intelligenza Artificiale usata come “giocattolo”',
        text: 'Qualche dipendente usa chatbot generici sul web, rischiando di caricare dati riservati senza una vera integrazione nei processi aziendali.',
      },
    ] satisfies ComparisonPoint[],
  },
  nzt: {
    badge: 'L’approccio NZT Solutions',
    title: 'Ingegneria applicata al flusso di lavoro',
    points: [
      {
        title: 'Ecosistema connesso',
        text: 'Scriviamo il codice che unisce i tuoi reparti. Quando succede un evento in azienda, il software aggiorna tutto il resto da solo.',
      },
      {
        title: 'Scalabilità strutturale',
        text: 'Automatizziamo le operazioni ripetitive a basso valore aggiunto, liberando il tuo team per le attività decisive.',
      },
      {
        title: 'AI incapsulata nel processo',
        text: 'L’Intelligenza Artificiale non è una chat esterna, ma un motore invisibile dentro i tuoi strumenti che legge, classifica, controlla e prepara il lavoro.',
      },
    ] satisfies ComparisonPoint[],
  },
};

// ---------------------------------------------------------------------------
// Form contatti (§3 Sezione 8)
// ---------------------------------------------------------------------------
export const contactFormCopy = {
  messagePlaceholder:
    'Descrivici brevemente il flusso di lavoro che vorresti migliorare o il progetto che hai in mente...',
  submitLabel: 'Invia Richiesta al Team NZT Solutions',
};
