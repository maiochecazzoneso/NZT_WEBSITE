// src/content/faqs.ts
// Domande frequenti (FaqSection). Testo semplice question/answer: pronto per il JSON-LD FAQPage
// generato da SchemaOrg.astro allo Step 6 (architettura tecnica §7).

export interface Faq {
  question: string;
  answer: string;
}

export const faqs: Faq[] = [
  {
    question: 'Quali servizi offre NZT Solutions?', // PLACEHOLDER
    answer: 'Risposta segnaposto alla prima domanda, da sostituire con il contenuto definitivo.', // PLACEHOLDER
  },
  {
    question: 'Come si svolge un progetto?', // PLACEHOLDER
    answer: 'Risposta segnaposto alla seconda domanda, da sostituire con il contenuto definitivo.', // PLACEHOLDER
  },
  {
    question: 'Quanto tempo richiede lo sviluppo?', // PLACEHOLDER
    answer: 'Risposta segnaposto alla terza domanda, da sostituire con il contenuto definitivo.', // PLACEHOLDER
  },
  {
    question: 'Il sito sarà ottimizzato per i motori di ricerca?', // PLACEHOLDER
    answer: 'Risposta segnaposto alla quarta domanda, da sostituire con il contenuto definitivo.', // PLACEHOLDER
  },
  {
    question: 'Come si richiede un preventivo?', // PLACEHOLDER
    answer: 'Risposta segnaposto alla quinta domanda, da sostituire con il contenuto definitivo.', // PLACEHOLDER
  },
];
