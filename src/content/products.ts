// src/content/products.ts
// Vetrina Prodotti Proprietari (Specifica Contenuti §3 Sezione 5) e copy della sottopagina /nzt-enterprise (§4).
// Claim allineati alla specifica tecnica: l'elaborazione è "quasi interamente" in locale, quindi niente
// "rischio zero" / "certezza matematica" ma affermazioni verificabili sull'architettura.
import { site } from './site';

export const products = {
  enterprise: {
    badge: 'Prodotto proprietario • Studi professionali, Uffici Legali & Amministrazioni',
    name: 'NZT Enterprise',
    subtitle:
      'Il cervello documentale in locale che conosce ogni riga del tuo archivio, con crittografia nativa.',
    description:
      'Quante ore perdono i tuoi professionisti a cercare una clausola o un precedente sepolto in migliaia di PDF, contratti, bilanci e pratiche? Con le AI pubbliche non puoi farlo senza violare privacy e segreto professionale. NZT Enterprise installa un motore di ricerca neurale dentro il tuo studio o la tua azienda: lavora in locale, cifra i dati personali direttamente nell’algoritmo di embedding e risponde a domande complesse sull’intero archivio storico. In pochi secondi hai la risposta con il link al documento e il numero di pagina, e i dati personali non lasciano mai in chiaro il tuo perimetro.',
    cta: { label: 'Esplora la scheda tecnica di NZT Enterprise', href: '/nzt-enterprise' },
  },
  pnote: {
    badge: 'Prodotto proprietario • Verticale Ristorazione & Accoglienza',
    name: 'Pnote — Voicebot AI',
    subtitle:
      'L’assistente vocale neurale che risponde al telefono e riempie l’agenda mentre tu lavori.',
    description:
      'Ogni chiamata persa durante il servizio è un tavolo vuoto e un cliente che prenota altrove. Pnote è il nostro sistema vocale progettato per i ristoranti: risponde al telefono H24 con voce naturale, capisce le richieste (orari, intolleranze, tavoli all’aperto), controlla le disponibilità reali in sala e registra la prenotazione da solo.',
    b2bNote:
      'Vuoi portare questa stessa tecnologia vocale nel centralino, nel supporto clienti o nella presa appuntamenti della tua azienda, fuori dalla ristorazione? Addestriamo agenti vocali su misura e li colleghiamo direttamente al tuo CRM o gestionale.',
    cta: { label: 'Vai al portale pnote.it', href: site.pnoteUrl },
    secondaryCta: { label: 'Porta il Voicebot nella tua azienda', href: '/#contatti' },
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
