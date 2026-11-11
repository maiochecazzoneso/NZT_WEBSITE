// src/content/services.ts
// Bento Grid dei servizi B2B (Specifica Contenuti §3 Sezione 4).
// `id` coincide con il valore di selectedServiceStore che la CTA della card preimposta nel form contatti.
import type { ServiceId } from './site';

export type ServiceMockup = 'dashboard' | 'pipeline' | 'audit';
export type ServiceLayout = 'wide' | 'narrow' | 'full';

export interface Service {
  id: ServiceId;
  tag: string;
  title: string;
  description: string;
  /** Esempi mostrati nel mockup UI della card */
  examples: string[];
  cta: string;
  mockup: ServiceMockup;
  layout: ServiceLayout;
}

export const services: Service[] = [
  {
    id: 'software-custom',
    tag: 'Custom Software Development',
    title: 'Costruiamo il software che sul mercato non esiste: il tuo.',
    description:
      'Ogni azienda ha regole, eccezioni e calcoli che i gestionali standard non riescono a gestire. Progettiamo e sviluppiamo applicativi web su misura, portali clienti/fornitori, gestionali operativi interni e dashboard direzionali in tempo reale. Tu definisci come lavora la tua azienda; noi costruiamo lo strumento veloce, intuitivo e blindato che lo rende possibile.',
    examples: [
      'Gestionali di produzione custom',
      'Portali B2B per reti vendita',
      'Dashboard di controllo commesse e margini',
    ],
    cta: 'Parliamo del tuo software',
    mockup: 'dashboard',
    layout: 'wide',
  },
  {
    id: 'automazione-ai',
    tag: 'AI Workflow Automation',
    title: 'Innestiamo l’Intelligenza Artificiale nei tuoi ingranaggi quotidiani.',
    description:
      'Analizziamo le operazioni ripetitive che rallentano i tuoi uffici e costruiamo pipeline automatiche che lavorano 24/7. Lettura e classificazione automatica di email e documenti in ingresso, estrazione dati da PDF o fatture, verifica incrociata tra ordini e bolle, generazione automatica di report e notifiche operative.',
    examples: [
      'Smistamento pratiche automatico',
      'Data-entry zero-click via OCR/LLM',
      'Sincronizzazione API tra software esistenti',
    ],
    cta: 'Automatizza un processo',
    mockup: 'pipeline',
    layout: 'narrow',
  },
  {
    id: 'consulenza-ai',
    tag: 'Tech & AI Advisory',
    title: 'Chiarezza ingegneristica prima di qualsiasi investimento.',
    description:
      'L’Intelligenza Artificiale offre opportunità enormi, ma è facile sprecare budget in strumenti inutili o insicuri. Entriamo nella tua realtà per mappare i processi, valutare la qualità e la sicurezza dei tuoi dati, calcolare il ritorno sull’investimento (ROI) reale di ogni automazione e disegnare la roadmap tecnica più solida per i tuoi obiettivi.',
    examples: [
      'Audit dei flussi di lavoro',
      'Studio di fattibilità AI Locale vs Cloud',
      'Progettazione architetturale',
    ],
    cta: 'Richiedi un Audit in azienda',
    mockup: 'audit',
    layout: 'full',
  },
];
