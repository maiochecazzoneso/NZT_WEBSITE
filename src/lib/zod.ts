// src/lib/zod.ts — unico punto di importazione di Zod per il progetto.
// Di default Zod 4 verifica con `new Function('')` se può compilare i validatori a runtime: sotto la
// nostra Content Security Policy (niente 'unsafe-eval') quella verifica verrebbe bloccata e segnalata
// come violazione. La modalità "jitless" la disattiva del tutto: stessa validazione, nessun eval.
import { z } from 'zod';

z.config({ jitless: true });

export { z };
