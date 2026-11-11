// src/content/method.ts
// Fasi del metodo di lavoro (Specifica Contenuti §3 Sezione 6, numerazione 01–04 generata dal componente).

export interface MethodStep {
  title: string;
  description: string;
}

export const methodSteps: MethodStep[] = [
  {
    title: 'Radiografia sul campo',
    description:
      'Prima di aprire l’editor ci sediamo accanto a chi lavora nei tuoi uffici. Guardiamo dove si inceppano le informazioni, quali fogli Excel tengono in piedi i reparti e in quale passaggio nascono gli errori che si ripetono ogni mese.',
  },
  {
    title: 'Architettura e Prototipo Navigabile',
    description:
      'Progettiamo la soluzione più dritta al risultato. Prima di scrivere il motore definitivo ti mostriamo a schermo le interfacce e il giro esatto che faranno i dati: sai cosa avrai in mano prima che inizi lo sviluppo pesante.',
  },
  {
    title: 'Costruzione e Innesto Indolore',
    description:
      'Sviluppiamo il software e addestriamo i modelli AI in ambienti di test isolati. Il collegamento ai tuoi gestionali attuali avviene dietro le quinte, mentre i tuoi collaboratori continuano a lavorare come sempre.',
  },
  {
    title: 'Accensione, Affiancamento e Telemetria',
    description:
      'Mettiamo il sistema online, formiamo il personale direttamente sulle loro postazioni e monitoriamo le prestazioni nel tempo, perché la velocità del primo giorno resti quella del primo anno.',
  },
];
