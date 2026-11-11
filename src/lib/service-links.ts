// src/lib/service-links.ts
// Link che preselezionano un servizio nel form contatti: <a href="/#contatti" data-service="automazione-ai">.
// Listener delegato unico (idempotente): imposta selectedServiceStore, poi la navigazione all'ancora prosegue
// normalmente (Lenis o browser). ContactForm.tsx è sincronizzato con lo store, anche se non ancora idratato.
import { selectedServiceStore } from './stores/uiStore';

let bound = false;

export function bindServiceLinks(): void {
  if (bound) return;
  bound = true;
  document.addEventListener('click', (event) => {
    const link = (event.target as HTMLElement | null)?.closest<HTMLElement>('[data-service]');
    const service = link?.dataset.service;
    if (service) selectedServiceStore.set(service);
  });
}
