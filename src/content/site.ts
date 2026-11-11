// src/content/site.ts
// Dati globali, navigazione e testi di sezione della Home aziendale.
// Copy: "Nuovo Copy Sito Web — concept Limitless", revisionato con l'"Audit Anti-AI Slop"
// (niente antitesi "non X, ma Y" ripetute, niente buzzword astratte, niente triplette meccaniche).
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
  'NZT Solutions collega i reparti della tua azienda con software su misura, automazioni e Intelligenza Artificiale privata: meno ore perse a ricopiare dati, più capacità con lo stesso organico. Parli direttamente con chi scrive il codice.';

// ---------------------------------------------------------------------------
// Navigazione. Href assoluti "/#…": funzionano dalla Home (Lenis li intercetta) e dalle sottopagine.
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
        description: 'Ricerca documentale AI in locale, con i dati personali cifrati',
      },
      {
        label: 'Pnote Voice AI',
        href: site.pnoteUrl,
        description: 'L’assistente vocale che prende le prenotazioni dei ristoranti',
        external: true,
      },
    ],
  },
  { label: 'Metodo', href: '/#metodo' },
  { label: 'FAQ', href: '/#faq' },
];

export const primaryCta = { label: 'Parla con Noi', href: '/#contatti' };

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
// Hero
// ---------------------------------------------------------------------------
export const hero = {
  badge: 'Ingegneria del software & Intelligenza Artificiale privata',
  // Due righe brevi composte dalle particelle 3D (l'isola misura il testo reale: righe separate da <br />)
  particleLines: ['Zero Attrito', 'Operativo'],
  title: 'La tua azienda viaggia al 20% del suo vero potenziale. Noi sblocchiamo il resto.',
  subtitle:
    'I dati per crescere li hai già: stanno nei PDF, nelle email, nel gestionale e nella testa delle tue persone. A frenarti sono le ore passate a ricopiare numeri tra programmi che non si parlano e a cercare informazioni sepolte nelle cartelle condivise. Entriamo nei tuoi flussi, togliamo il lavoro manuale e scriviamo il software su misura che fa girare l’impresa a pieno regime.',
  primaryCta: { label: 'Prenota un’Analisi Tecnica', href: '/#contatti' },
  secondaryCta: { label: 'Scopri Cosa Costruiamo', href: '/#servizi' },
  scrollHint: 'Scorri nei sistemi ↓',
};

// Control Room (HeroInteractiveMockup.tsx): blocco subito dopo la Hero. I valori sono simulati.
export const controlRoom = {
  eyebrow: 'Control Room NZT Solutions · Telemetria simulata',
  title: 'Cosa succede quando tutti i reparti ragionano come un unico sistema.',
};

// ---------------------------------------------------------------------------
// TrustBar (i 4 pilastri)
// ---------------------------------------------------------------------------
export const trustPillars = [
  {
    title: 'Codice 100% Proprietario',
    text: 'Scritto da zero sulle tue logiche operative, senza template da adattare.',
  },
  {
    title: 'Sinapsi tra i Reparti',
    text: 'I software che usi già ogni giorno si scambiano i dati in tempo reale.',
  },
  {
    title: 'Segreto Industriale Blindato',
    text: 'Modelli AI in locale e dati personali cifrati prima dell’indicizzazione.',
  },
  {
    title: 'Da Ingegnere a Imprenditore',
    text: 'Parli sempre con chi progetta e scrive il tuo sistema. Zero commerciali.',
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
    title:
      'Hai assunto persone brillanti per far crescere l’azienda. Perché passano metà della giornata a fare da cavo di collegamento tra due schermi?',
    lead: 'Ogni giorno dentro la tua azienda passano preventivi, storico clienti, varianti tecniche, contratti e marginalità di commessa, spezzettati tra software che non si vedono tra loro. Così i tuoi profili migliori fanno da “ponte umano”: aprono un PDF, copiano tre righe su Excel, le ricopiano nel gestionale, mandano l’email di conferma e ricontrollano a mano di non aver sbagliato una cifra. Il nostro lavoro è togliere questo tappo. Quando dati, software e Intelligenza Artificiale stanno nella stessa architettura, l’azienda torna a usare la capacità che ha già e le emergenze tornano a essere eccezioni.',
  },
  services: {
    eyebrow: 'Cosa progettiamo',
    title: 'Tre leve per togliere i freni alla tua operatività.',
    lead: 'Interveniamo dove i software preconfezionati si arrendono: dall’analisi dei colli di bottiglia fino alla scrittura di piattaforme proprietarie e automazioni su misura.',
  },
  products: {
    eyebrow: 'Tecnologie proprietarie NZT',
    title: 'Sistemi già pronti, nati sul campo per problemi che conosciamo a memoria.',
    lead: 'Accanto allo sviluppo su misura abbiamo ingegnerizzato due prodotti verticali, pronti da installare nella tua struttura.',
  },
  method: {
    eyebrow: 'Come lavoriamo',
    title: 'Il nuovo sistema entra in azienda senza fermare gli uffici nemmeno un giorno.',
    lead: 'Cambiare gli strumenti informatici spaventa molte aziende per il timore di bloccare gli uffici. Il nostro protocollo in 4 passaggi innesta la nuova tecnologia mentre la tua azienda continua a correre.',
  },
  faq: {
    eyebrow: 'Domande dirette, risposte tecniche',
    title: 'Tutto quello che è giusto chiarire prima di metterci al tavolo.',
    lead: 'Hai un caso particolare o un dubbio sull’infrastruttura? Nella prima chiamata parli direttamente con i nostri ingegneri.',
  },
  cta: {
    eyebrow: 'Parla con noi',
    title: 'Sblocca il 100% della capacità operativa della tua azienda.',
    lead: 'Che tu abbia in mente un software proprietario da creare da zero, un ufficio intero da liberare dal copia-incolla o l’installazione di NZT Enterprise nel tuo studio, mettiamoci a un tavolo tecnico e guardiamo i numeri.',
  },
} satisfies Record<string, SectionCopy>;

// ---------------------------------------------------------------------------
// Confronto "Azienda frenata" / "Azienda sotto effetto NZT"
// ---------------------------------------------------------------------------
export interface ComparisonPoint {
  title: string;
  text: string;
}

export const comparison = {
  traditional: {
    badge: 'Azienda frenata',
    title: 'Lentezza burocratica e memoria frammentata',
    points: [
      {
        title: 'Reparti a compartimenti stagni',
        text: 'CRM, fatturazione, fogli Excel, PEC e produzione vivono su isole separate. Se un dato cambia in un posto, qualcuno deve ricordarsi di aggiornarlo a mano in tutti gli altri.',
      },
      {
        title: 'Crescita bloccata dalla burocrazia',
        text: 'Se domani raddoppiano gli ordini vai in apnea: per reggere l’urto devi assumere altre persone solo per inserire dati e rincorrere carte.',
      },
      {
        title: 'AI usata alla cieca (e a rischio)',
        text: 'Qualche collaboratore incolla contratti e dati sensibili su chatbot gratuiti online. Il segreto aziendale resta esposto e in ufficio non nasce nessun automatismo stabile.',
      },
    ] satisfies ComparisonPoint[],
  },
  nzt: {
    badge: 'Azienda sotto effetto NZT',
    title: 'Lucidità operativa e processi che girano da soli',
    points: [
      {
        title: 'Rete neurale aziendale',
        text: 'Scriviamo il codice che salda insieme i tuoi strumenti. Una fattura registrata in amministrazione aggiorna da sola produzione, logistica e controllo di gestione.',
      },
      {
        title: 'Più capacità a parità di organico',
        text: 'Il lavoro meccanico scorre sullo sfondo. Le ore recuperate tornano a chi segue i clienti e tiene d’occhio i margini.',
      },
      {
        title: 'Intelligenza Artificiale dentro il motore',
        text: 'L’AI lavora dentro i programmi che usi già: legge i documenti in arrivo, incrocia i dati con lo storico, segnala le anomalie e ti presenta la pratica già preparata.',
      },
    ] satisfies ComparisonPoint[],
  },
};

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
