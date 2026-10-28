// src/content/services.ts
// Servizi della Bento Grid (architettura tecnica §4, architettura grafica §5.2.4).
// Titoli ricavati dal sottotitolo Hero (architettura grafica §4.5); descrizioni provvisorie.

export type ServiceMockup = 'latency' | 'terminal' | 'flow';
export type ServiceLayout = 'wide' | 'narrow' | 'full';

export interface Service {
  /** Identificativo stabile: in futuro alimenterà selectedServiceStore / ContactForm (Step 4 e 6) */
  id: string;
  tag: string;
  title: string;
  description: string;
  mockup: ServiceMockup;
  layout: ServiceLayout;
}

export const services: Service[] = [
  {
    id: 'web',
    tag: 'Web', // PLACEHOLDER
    title: 'Ecosistemi web', // PLACEHOLDER (dal sottotitolo Hero)
    description:
      'Testo segnaposto: descrizione del servizio di progettazione di siti ed ecosistemi web, da sostituire con il copy definitivo.', // PLACEHOLDER
    mockup: 'latency',
    layout: 'wide',
  },
  {
    id: 'software',
    tag: 'Software', // PLACEHOLDER
    title: 'Software su misura', // PLACEHOLDER (dal sottotitolo Hero)
    description:
      'Testo segnaposto: descrizione del servizio di sviluppo software su misura, da sostituire con il copy definitivo.', // PLACEHOLDER
    mockup: 'terminal',
    layout: 'narrow',
  },
  {
    id: 'automazioni',
    tag: 'Automazioni', // PLACEHOLDER
    title: 'Automazioni aziendali', // PLACEHOLDER (dal sottotitolo Hero)
    description:
      'Testo segnaposto: descrizione del servizio di automazione dei processi aziendali, da sostituire con il copy definitivo.', // PLACEHOLDER
    mockup: 'flow',
    layout: 'full',
  },
];
