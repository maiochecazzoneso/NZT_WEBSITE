// src/content/faqs.ts
// Domande frequenti sull'azienda (Specifica Contenuti §3 Sezione 7). Testo semplice question/answer:
// pronto per il JSON-LD FAQPage (architettura tecnica §7).

export interface Faq {
  question: string;
  answer: string;
}

export const faqs: Faq[] = [
  {
    question: 'Con che tipo di realtà lavora NZT Solutions?',
    answer:
      'Affianchiamo PMI manifatturiere, di servizi o commerciali, studi professionali (commercialisti, avvocati, consulenti del lavoro, notai) e uffici amministrativi strutturati. Il punto in comune è uno: hanno capito che il lavoro manuale al computer sta frenando la crescita e vogliono più velocità operativa con software proprietario e AI sicura.',
  },
  {
    question: 'Dobbiamo buttare via il gestionale che usiamo oggi per lavorare con voi?',
    answer:
      'No. Nella maggior parte dei casi il salto più rapido si ottiene lasciando al loro posto i programmi che i tuoi dipendenti conoscono già e costruendo sotto il cofano i connettori API e gli agenti AI che spostano, controllano e aggiornano i dati tra un programma e l’altro al posto delle persone.',
  },
  {
    question: 'Se usiamo l’Intelligenza Artificiale sui nostri documenti, chi vede i nostri dati?',
    answer:
      'Progettiamo architetture private e installiamo sistemi proprietari come NZT Enterprise, che lavorano in locale sui tuoi server e cifrano i dati personali prima ancora dell’indicizzazione. I tuoi documenti non finiscono sui chatbot pubblici; se un componente esterno serve davvero, lo concordiamo e lo mettiamo per iscritto con te prima di installarlo.',
  },
  {
    question:
      'Come si svolge il primo incontro? C’è un commerciale che cerca di vendermi un pacchetto?',
    answer:
      'In NZT Solutions non abbiamo venditori. Il primo colloquio è gratuito e lo fai con un ingegnere del nostro team. Guardiamo insieme il flusso che vuoi sbloccare e ti diciamo con franchezza se l’intervento ha senso, quanto tempo può farti recuperare e quale strada tecnica conviene.',
  },
];
