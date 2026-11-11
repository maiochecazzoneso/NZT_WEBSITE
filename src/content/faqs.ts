// src/content/faqs.ts
// Domande frequenti sull'azienda (Specifica Contenuti §3 Sezione 7). Testo semplice question/answer:
// pronto per il JSON-LD FAQPage (architettura tecnica §7).

export interface Faq {
  question: string;
  answer: string;
}

export const faqs: Faq[] = [
  {
    question: 'Che tipo di aziende si rivolge a NZT Solutions?',
    answer:
      'Lavoriamo con PMI strutturate, studi professionali (commercialisti, avvocati, consulenti del lavoro), uffici amministrativi e aziende di servizi o produzione che vogliono digitalizzare processi complessi, creare un software proprietario o introdurre l’AI nei propri flussi di lavoro in modo sicuro e concreto.',
  },
  {
    question:
      'Costruite solo nuovi software da zero o potete automatizzare i programmi che usiamo già?',
    answer:
      'Facciamo entrambe le cose. Spesso il valore più grande nasce dal far dialogare tra loro i software che hai già in azienda attraverso connettori API e agenti di Intelligenza Artificiale che eliminano il lavoro manuale di copia-incolla tra un sistema e l’altro.',
  },
  {
    question:
      'Come garantite la riservatezza dei dati aziendali quando integrate l’Intelligenza Artificiale?',
    answer:
      'La sicurezza del dato è il nostro punto di partenza. A differenza di chi si limita a collegare il tuo gestionale a chatbot pubblici, noi progettiamo architetture isolate e sistemi proprietari (come NZT Enterprise) capaci di elaborare i dati in locale e criptare le informazioni personali prima ancora dell’indicizzazione.',
  },
  {
    question: 'Come funziona il primo contatto? Ha un costo?',
    answer:
      'Il primo colloquio conoscitivo è gratuito e avviene direttamente con un nostro profilo tecnico, non con un venditore. Serve a capire il tuo scenario operativo e a dirti con estrema trasparenza se e come la nostra tecnologia può farti risparmiare tempo e risorse.',
  },
];
