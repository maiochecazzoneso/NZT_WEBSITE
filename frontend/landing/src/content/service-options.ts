// src/content/service-options.ts
// Opzioni del modulo contatti. Nessuna dipendenza da import.meta.env: il modulo è importato sia dal
// sito (Astro/Vite) sia dalla Pages Function POST /api/contact (bundle di wrangler).

export const serviceOptions = [
  { value: 'generale', label: 'Voglio fare un’analisi generale dei flussi della mia azienda' },
  { value: 'software-custom', label: 'Sviluppo Software su Misura / Web App Proprietaria' },
  { value: 'automazione-ai', label: 'Automazione Uffici & Intelligenza Artificiale nei Processi' },
  { value: 'consulenza-ai', label: 'Audit Tecnico & Studio di Fattibilità AI' },
  { value: 'nzt-enterprise', label: 'Prodotto: NZT Enterprise (Ricerca Documentale AI in Locale)' },
  { value: 'voicebot-b2b', label: 'Prodotto: Pnote / Soluzioni Voicebot AI Telefoniche' },
] as const;

export type ServiceId = (typeof serviceOptions)[number]['value'];
