// src/lib/stores/uiStore.ts
import { atom } from 'nanostores';

// 1. Stato per il servizio selezionato dall'utente (0.3 KB di libreria)
export const selectedServiceStore = atom<string>('generale');

// 2. Stato globale per mettere in pausa tutte le animazioni (stile pnote.it)
export const animationsPausedStore = atom<boolean>(false);
