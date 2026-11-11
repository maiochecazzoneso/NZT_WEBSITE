// src/content/products.ts
// Vetrina Prodotti Proprietari (Specifica Contenuti §3 Sezione 5) e copy della sottopagina /nzt-enterprise (§4).
// Claim allineati alla specifica tecnica: l'elaborazione è "quasi interamente" in locale, quindi niente
// "rischio zero" / "certezza matematica" ma affermazioni verificabili sull'architettura.
import { site } from './site';

export const products = {
  enterprise: {
    badge: 'Prodotto proprietario • Studi professionali & aziende',
    name: 'NZT Enterprise',
    subtitle: 'Sistema RAG di Intelligenza Documentale in Locale con Crittografia dei Dati.',
    description:
      'Hai migliaia di documenti, contratti, bilanci e pratiche da analizzare, ma non puoi caricarli su AI pubbliche per motivi di privacy e segreto professionale? NZT Enterprise indicizza l’intero archivio del tuo studio o della tua amministrazione lavorando in locale e criptando i dati personali direttamente nell’algoritmo di embedding. Chiedi e ottieni risposte immediate con la citazione della fonte, senza che i dati personali escano in chiaro dal tuo perimetro.',
    cta: { label: 'Apri la scheda tecnica di NZT Enterprise', href: '/nzt-enterprise' },
  },
  pnote: {
    badge: 'Prodotto proprietario • Verticale ristorazione',
    name: 'Pnote — Voicebot AI',
    subtitle:
      'Assistente Vocale Neurale per la gestione autonoma delle chiamate e delle prenotazioni.',
    description:
      'Il nostro sistema di Intelligenza Artificiale vocale progettato specificamente per il settore della ristorazione. Risponde al telefono con voce naturale, comprende le richieste dei clienti, verifica le disponibilità dei tavoli e registra le prenotazioni in autonomia.',
    b2bNote:
      'Vuoi portare la nostra tecnologia Voicebot nel customer care o nel centralino della tua azienda (fuori dalla ristorazione)? Sviluppiamo integrazioni vocali custom sui tuoi sistemi.',
    cta: { label: 'Visita il portale dedicato pnote.it', href: site.pnoteUrl },
    secondaryCta: { label: 'Chiedi un Voicebot per la tua azienda', href: '/#contatti' },
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
    lead: 'Chi lavora con documenti contabili, fiscali, legali o industriali sa di non poter caricare i file dei propri clienti su piattaforme cloud esterne. NZT Enterprise nasce nei laboratori di NZT Solutions per ribaltare questo paradigma attraverso tre pilastri ingegneristici.',
    pillars: [
      {
        title: 'Algoritmo di Embedding con Crittografia dei Dati Personali',
        text: 'Durante la fase di lettura e indicizzazione massiva dei file, il nostro algoritmo proprietario intercetta e cripta i dati personali e sensibili prima della vettorizzazione. Il sistema comprende le relazioni logiche, contabili e giuridiche dei documenti mantenendo schermate le informazioni riservate.',
      },
      {
        title: 'Elaborazione quasi interamente in Locale',
        text: 'L’infrastruttura di calcolo lavora direttamente sulla tua macchina o sul server aziendale. L’intelligenza viene portata dove risiedono i tuoi file, invece di spedire i tuoi file verso server sconosciuti. Cosa resta in locale e cosa no viene definito e documentato insieme a te in fase di installazione.',
      },
      {
        title: 'Risposte Verificabili con Citazione Puntuale',
        text: 'Ogni risposta è ancorata ai tuoi documenti. Per ogni informazione estratta, NZT Enterprise indica il nome del file, la data e la pagina esatta da cui ha preso il dato, permettendoti di aprire il documento originale con un click e verificarlo.',
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
