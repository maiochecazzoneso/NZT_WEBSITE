// src/lib/spotlight.ts
// Spotlight delle .specular-card statiche (.astro): equivalente vanilla e delegato di Card.tsx
// (architettura grafica §6.1). Un solo listener passivo su document, aggiornamento coalescente via
// requestAnimationFrame, solo variabili CSS --mouse-x / --mouse-y (nessun re-render, nessuna scrittura di layout).
let activeCard: HTMLElement | null = null;
let pointerX = 0;
let pointerY = 0;
let frame = 0;

function update(): void {
  frame = 0;
  if (!activeCard) return;
  const rect = activeCard.getBoundingClientRect();
  activeCard.style.setProperty('--mouse-x', `${pointerX - rect.left}px`);
  activeCard.style.setProperty('--mouse-y', `${pointerY - rect.top}px`);
}

export function initSpotlight(): void {
  // Solo con puntatore fine e hover reale: nessun lavoro inutile sui dispositivi touch
  if (!window.matchMedia('(hover: hover) and (pointer: fine)').matches) return;
  document.addEventListener(
    'pointermove',
    (event) => {
      const target = event.target;
      activeCard = target instanceof Element ? target.closest<HTMLElement>('.specular-card') : null;
      pointerX = event.clientX;
      pointerY = event.clientY;
      if (activeCard && !frame) frame = requestAnimationFrame(update);
    },
    { passive: true },
  );
}
