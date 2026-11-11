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
    title: 'Costruiamo lo strumento che calza al millimetro sul tuo modo di lavorare.',
    description:
      'La tua azienda ha regole che nessun gestionale standard ha previsto: il listino composto per il cliente storico, lo sconto che cambia con il volume, il passaggio di reparto che oggi vive in un foglio Excel. Progettiamo applicativi web proprietari, portali per reti vendita o fornitori e cruscotti direzionali che calcolano i margini al centesimo e in tempo reale. Le regole del business restano le tue; il software le applica ogni volta, anche quelle che oggi qualcuno deve ricordarsi a memoria.',
    examples: [
      'Gestionali operativi e di produzione su misura',
      'Portali B2B per agenti, clienti e fornitori',
      'Dashboard direzionali per il controllo vivo di commesse e marginalità',
    ],
    cta: 'Progettiamo il tuo software',
    mockup: 'dashboard',
    layout: 'wide',
  },
  {
    id: 'automazione-ai',
    tag: 'AI Workflow Automation',
    title: 'Mettiamo il pilota automatico al lavoro sporco dei tuoi uffici.',
    description:
      'Individuiamo i passaggi dove i tuoi uffici perdono ore ogni settimana e li trasformiamo in flussi automatici attivi giorno e notte. I nostri sistemi leggono le email e gli allegati in entrata, estraggono i dati da fatture, DDT e contratti, verificano che gli importi tra ordine e bolla combacino e caricano tutto sul gestionale. Ai tuoi operatori resta un clic di conferma sulle sole eccezioni.',
    examples: [
      'Lettura e smistamento di pratiche, PEC ed email',
      'Inserimento dati a zero clic con modelli OCR e LLM',
      'Ponti API per sincronizzare in tempo reale i programmi che hai già',
    ],
    cta: 'Sblocca un flusso di lavoro',
    mockup: 'pipeline',
    layout: 'narrow',
  },
  {
    id: 'consulenza-ai',
    tag: 'Tech & AI Advisory',
    title: 'Numeri alla mano e architettura chiara, prima di spendere un solo euro in codice.',
    description:
      'Intorno all’Intelligenza Artificiale c’è molto rumore e il rischio di comprare scatole vuote è alto. Prima di scrivere una riga di software entriamo in azienda per una radiografia tecnica dei reparti: misuriamo quante ore se ne vanno nei passaggi manuali, verifichiamo dove stanno i dati sensibili e calcoliamo in quanti mesi ogni intervento si ripaga da solo.',
    examples: [
      'Mappatura dei colli di bottiglia e calcolo delle ore recuperabili',
      'Valutazione di sicurezza e studio AI Locale (On-Premise) vs Cloud',
      'Disegno dell’architettura tecnica e piano di ritorno sull’investimento (ROI)',
    ],
    cta: 'Richiedi un Audit Tecnico in azienda',
    mockup: 'audit',
    layout: 'full',
  },
];
