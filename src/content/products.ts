// src/content/products.ts
// Vetrina Prodotti Proprietari (Specifica Contenuti §3 Sezione 5) e copy della sottopagina /nzt-enterprise (§4).
// Claim allineati alla specifica tecnica: l'elaborazione è "quasi interamente" in locale, quindi niente
// "rischio zero" / "certezza matematica" ma affermazioni verificabili sull'architettura.
import { site } from './site';

export const products = {
  enterprise: {
    badge: 'Prodotto proprietario • Studi professionali & Aziende',
    name: 'NZT Enterprise',
    subtitle: 'Motore di ricerca e analisi documentale AI in locale, con crittografia nativa.',
    description:
      'Migliaia di contratti, bilanci e pratiche da consultare senza poter usare AI pubbliche per ragioni di segreto professionale? NZT Enterprise trasforma il tuo archivio in una mente interrogabile. Lavora in locale e cripta i dati sensibili direttamente nell’algoritmo di embedding; ogni risposta arriva in pochi secondi con la pagina e il documento originale citati.',
    cta: { label: 'Apri la scheda tecnica di NZT Enterprise', href: '/nzt-enterprise' },
  },
  pnote: {
    badge: 'Prodotto proprietario • Settore Ristorazione & Accoglienza',
    name: 'Pnote — Voicebot AI',
    subtitle: 'Assistente vocale autonomo per la gestione telefonica e le prenotazioni.',
    description:
      'Quando il telefono squilla nel pieno del servizio, risponde Pnote. Parla con voce naturale, controlla la disponibilità reale in sala e registra la prenotazione da solo, mentre il tuo staff resta ai tavoli.',
    b2bNote:
      'Cerchi un centralino vocale AI per la tua azienda (fuori dalla ristorazione)? Adattiamo il motore vocale di Pnote al tuo customer care.',
    cta: { label: 'Visita pnote.it', href: site.pnoteUrl },
    secondaryCta: { label: 'Richiedi un Voicebot aziendale', href: '/#contatti' },
  },
};

export const enterprisePage = {
  meta: {
    title: 'NZT Enterprise — AI documentale in locale per studi e aziende | NZT Solutions',
    description:
      'NZT Enterprise è il sistema RAG di NZT Solutions che interroga contratti, bilanci e pratiche lavorando in locale e criptando i dati personali prima dell’indicizzazione. Risposte con citazione puntuale della fonte.',
  },
  hero: {
    backLink: { label: 'Torna a NZT Solutions', href: '/' },
    badge: 'Prodotto proprietario NZT Solutions • Document Intelligence',
    title:
      'NZT Enterprise: l’Intelligenza Artificiale addestrata sui tuoi documenti, chiusa dentro il tuo perimetro.',
    subtitle:
      'Progettato per Studi Commercialisti, Studi Legali, Amministrazioni e Aziende ad alta densità documentale. Interroga decine di migliaia di pratiche, contratti, bilanci e normative con un’architettura costruita perché nessun dato personale o aziendale esca in chiaro verso terzi.',
    cta: { label: 'Richiedi una Demo per il tuo Studio / Azienda', href: '#contatti' },
  },
  innovation: {
    eyebrow: 'L’innovazione tecnologica',
    title: 'Come abbiamo risolto il paradosso tra potenza dell’AI e segreto professionale.',
    lead: 'Chi lavora con documenti contabili, fiscali, legali o industriali sa di non poter caricare i file dei propri clienti su piattaforme cloud esterne. Abbiamo costruito NZT Enterprise attorno a questo vincolo: ecco come funziona.',
    pillars: [
      {
        title: 'Algoritmo di Embedding con Crittografia dei Dati Personali',
        text: 'Durante la fase di lettura e indicizzazione massiva dei file, il nostro algoritmo proprietario intercetta e cripta i dati personali e sensibili prima della vettorizzazione. Il sistema comprende le relazioni logiche, contabili e giuridiche dei documenti mantenendo schermate le informazioni riservate.',
      },
      {
        title: 'Elaborazione quasi interamente in Locale',
        text: 'L’infrastruttura di calcolo gira sulla tua macchina o sul server aziendale, dove stanno già i tuoi file. Cosa resta in locale e cosa no viene definito e messo per iscritto insieme a te in fase di installazione.',
      },
      {
        title: 'Risposte Verificabili con Citazione Puntuale',
        text: 'Per ogni informazione estratta NZT Enterprise indica il file, la data e la pagina da cui ha preso il dato. Un clic apre il documento originale, così chi firma il parere può controllare la fonte prima di usarla.',
      },
    ],
  },
  useCases: {
    eyebrow: 'A chi si rivolge',
    title: 'Dove NZT Enterprise trasforma ore di ricerca in pochi secondi.',
    cards: [
      {
        title: 'Studi Commercialisti, Contabili e Consulenti del Lavoro',
        text: 'Incrocia bilanci, dichiarazioni, contratti di locazione/leasing, circolari e storico delle comunicazioni dei clienti. Chiedi al sistema di estrarre scadenze, anomalie o clausole specifiche su centinaia di posizioni in un istante.',
      },
      {
        title: 'Studi Legali e Notarili',
        text: 'Ricerca semantica istantanea dentro archivi storici di atti, sentenze, contratti e perizie. Trova precedenti interni allo studio o confronta versioni diverse di un contratto senza dover leggere manualmente centinaia di pagine.',
      },
      {
        title: 'Uffici Amministrativi e Direzioni Aziendali',
        text: 'Interroga lo storico di preventivi, ordini d’acquisto, capitolati tecnici, fatture e procedure interne. Rispondi subito a verifiche, audit o contestazioni fornitori avendo tutto lo storico documentale a portata di domanda.',
      },
    ],
  },
  cta: {
    eyebrow: 'Demo NZT Enterprise',
    title: 'Mettiamo NZT Enterprise alla prova sui casi del tuo studio.',
    lead: 'Raccontaci che tipo di archivio gestisci e quali ricerche ti costano più tempo: un nostro ingegnere ti mostrerà come il sistema risponde su scenari analoghi ai tuoi e quale infrastruttura serve per installarlo nel tuo perimetro.',
  },
};
