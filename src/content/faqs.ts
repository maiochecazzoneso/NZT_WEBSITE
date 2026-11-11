// src/content/faqs.ts
// Domande frequenti. Testo semplice question/answer: pronto per il JSON-LD FAQPage (architettura tecnica §7).

export interface Faq {
  question: string;
  answer: string;
}

export const faqs: Faq[] = [
  {
    question: 'Che tipo di realtà si rivolge a NZT Solutions?',
    answer:
      'Lavoriamo con PMI strutturate, studi professionali (commercialisti, avvocati, consulenti del lavoro) e uffici amministrativi. Di solito ci chiamano quando il lavoro manuale al computer ha iniziato a rallentare la crescita, oppure quando vogliono usare l’Intelligenza Artificiale sui propri documenti in modo sicuro.',
  },
  {
    question: 'Dobbiamo cambiare i programmi che usiamo oggi per lavorare con voi?',
    answer:
      'No. Spesso il risultato migliore si ottiene lasciando al loro posto i software che usi già, costruendo dietro le quinte i connettori API e le automazioni AI che passano e controllano i dati da un programma all’altro al posto delle persone.',
  },
  {
    question: 'Come garantite la riservatezza dei dati aziendali con l’Intelligenza Artificiale?',
    answer:
      'Progettiamo architetture private e sistemi proprietari (come NZT Enterprise) che elaborano i documenti in locale e criptano le informazioni personali prima ancora dell’indicizzazione. I tuoi archivi restano fuori dai chatbot pubblici.',
  },
  {
    question: 'Come funziona il primo contatto? Ha un costo?',
    answer:
      'Il primo colloquio è gratuito e lo fai direttamente con un nostro ingegnere. Guardiamo insieme il problema che vuoi risolvere e ti diciamo con franchezza se si può fare e in quanto tempo.',
  },
];
