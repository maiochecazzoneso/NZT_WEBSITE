// src/content/method.ts
// Fasi del metodo di lavoro (Specifica Contenuti §3 Sezione 6, numerazione 01–04 generata dal componente).

export interface MethodStep {
  title: string;
  description: string;
}

export const methodSteps: MethodStep[] = [
  {
    title: 'Immersione nel tuo Flusso',
    description:
      'Non partiamo dal codice, partiamo dal tuo lavoro. Analizziamo come si muovono le informazioni oggi nella tua azienda e dove si generano rallentamenti, colli di bottiglia o errori.',
  },
  {
    title: 'Architettura & Prototipo Visivo',
    description:
      'Disegniamo la soluzione tecnica più snella ed efficace. Prima di sviluppare l’intero sistema, ti mostriamo i flussi e le interfacce per validare insieme ogni passaggio.',
  },
  {
    title: 'Sviluppo Modulare & Integrazione',
    description:
      'Scriviamo il software e configuriamo i modelli AI in ambienti sicuri, collegandoci ai tuoi strumenti attuali senza mai bloccare l’operatività dei tuoi uffici.',
  },
  {
    title: 'Rilascio, Formazione e Supporto Continuo',
    description:
      'Mettiamo il sistema in produzione, affianchiamo il tuo personale nell’utilizzo quotidiano e monitoriamo le prestazioni nel tempo.',
  },
];
