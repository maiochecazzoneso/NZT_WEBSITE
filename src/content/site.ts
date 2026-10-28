// src/content/site.ts
// Dati globali e testi di sezione della landing page. Ogni testo provvisorio è marcato `// PLACEHOLDER`.

export const site = {
  name: 'NZT Solutions',
  // Area Clienti futura (architettura tecnica §9, grafica §5.2.1): sottodominio non ancora attivo
  clientAreaUrl: 'https://clienti.nztsolutions.it',
  legal: {
    vat: 'P.IVA da definire', // PLACEHOLDER: partita IVA
    // Pagine legali previste (architettura tecnica §4) ma non ancora create: mostrate come testo, senza link
    pages: [
      { label: 'Privacy Policy', href: '/privacy-policy' },
      { label: 'Cookie Policy', href: '/cookie-policy' },
    ],
  },
} as const;

export interface NavLink {
  label: string;
  href: string;
}

export const navLinks: NavLink[] = [
  { label: 'Approccio', href: '#approccio' }, // PLACEHOLDER: etichetta
  { label: 'Servizi', href: '#servizi' }, // PLACEHOLDER: etichetta
  { label: 'Metodo', href: '#metodo' }, // PLACEHOLDER: etichetta
  { label: 'FAQ', href: '#faq' }, // PLACEHOLDER: etichetta
];

// Etichetta della CTA primaria della Hero (architettura grafica §4.5)
export const primaryCta = { label: 'Inizia un Progetto', href: '#contatti' };

export interface SectionCopy {
  eyebrow: string;
  title: string;
  lead: string;
}

export const sectionCopy = {
  problem: {
    eyebrow: 'Confronto architetturale', // da architettura grafica §5.2.3
    title: 'Prima e dopo NZT Solutions', // da architettura tecnica §4 (ProblemSolution)
    lead: 'Testo segnaposto: introduzione al confronto tra un sito tradizionale e lo standard NZT Solutions, da sostituire con il copy definitivo.', // PLACEHOLDER
  },
  services: {
    eyebrow: 'Servizi', // PLACEHOLDER
    title: 'Ecosistemi web, software su misura e automazioni', // PLACEHOLDER (dal sottotitolo Hero)
    lead: 'Testo segnaposto: breve presentazione dei servizi, da sostituire con il copy definitivo.', // PLACEHOLDER
  },
  method: {
    eyebrow: 'Metodo', // PLACEHOLDER
    title: 'Come lavoriamo', // da architettura tecnica §4 (WorkflowSimulator)
    lead: 'Testo segnaposto: descrizione del processo di lavoro in quattro fasi, da sostituire con il copy definitivo.', // PLACEHOLDER
  },
  faq: {
    eyebrow: 'FAQ', // PLACEHOLDER
    title: 'Domande frequenti',
    lead: 'Testo segnaposto: introduzione alle domande frequenti, da sostituire con il copy definitivo.', // PLACEHOLDER
  },
  cta: {
    eyebrow: 'Contatti', // PLACEHOLDER
    title: 'Inizia un Progetto', // etichetta CTA Hero (architettura grafica §4.5)
    lead: 'Testo segnaposto: invito al contatto, da sostituire con il copy definitivo.', // PLACEHOLDER
  },
} satisfies Record<string, SectionCopy>;

// Segnaposto del modulo contatti (ContactForm.tsx arriverà allo Step 6): nessun campo finto
export const contactPlaceholder = {
  badge: 'Modulo di contatto', // PLACEHOLDER
  text: 'Il modulo di contatto sarà disponibile a breve.', // PLACEHOLDER
};

// Tecnologie dello stack (architettura tecnica §2) mostrate nella TrustBar — solo testo, loghi in arrivo
export const trustStack: string[] = [
  'Astro',
  'React',
  'TypeScript',
  'Tailwind CSS',
  'GSAP',
  'Three.js',
];

export interface Metric {
  label: string;
  value: string;
}

// Performance budget di progetto (architettura tecnica §1): OBIETTIVI da verificare con misure reali prima del lancio
export const performanceBudget: Metric[] = [
  { label: 'PageSpeed', value: '98–100' },
  { label: 'LCP', value: '< 1.2 s' },
  { label: 'CLS', value: '0.00' },
  { label: 'INP', value: '< 80 ms' },
];

export const comparison = {
  traditional: {
    badge: 'Approccio comune', // PLACEHOLDER
    title: 'Siti Web Tradizionali', // architettura grafica §5.2.3
    description:
      'Testo segnaposto: descrizione dei limiti tipici di un sito tradizionale, da sostituire con il copy definitivo.', // PLACEHOLDER
    // PLACEHOLDER: valori di confronto da definire (nessun dato inventato)
    metrics: performanceBudget.map((metric) => ({ label: metric.label, value: '—' })),
  },
  nzt: {
    badge: 'Performance budget', // obiettivi di progetto (architettura tecnica §1)
    title: 'Standard NZT Solutions', // architettura grafica §5.2.3
    description:
      'Testo segnaposto: descrizione dello standard NZT Solutions, da sostituire con il copy definitivo.', // PLACEHOLDER
    metrics: performanceBudget,
  },
};
