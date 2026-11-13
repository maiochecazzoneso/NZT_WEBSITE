// src/lib/contact-schema.ts — schema del modulo contatti condiviso tra client (ContactForm.tsx) e server
// (/api/contact): la validazione lato browser è una cortesia, quella che conta è la stessa ripetuta sul server.
import { z } from 'zod';
import { serviceOptions, type ServiceId } from '@/content/site';

export const serviceValues = serviceOptions.map((option) => option.value) as [
  ServiceId,
  ...ServiceId[],
];

export const contactSchema = z.object({
  name: z.string().trim().min(2, 'Inserisci nome e cognome.').max(120, 'Nome troppo lungo.'),
  email: z.string().trim().email('Inserisci un indirizzo email valido.').max(254),
  company: z.string().trim().min(2, 'Indica l’azienda o lo studio.').max(160, 'Nome troppo lungo.'),
  phone: z
    .string()
    .trim()
    .max(40, 'Numero non valido.')
    .regex(/^$|^[+\d][\d\s./-]{5,}$/, 'Numero non valido.')
    .optional(),
  service: z.enum(serviceValues),
  // Facoltativo per il nuovo copy: chi scrive poco non va bloccato
  message: z.string().trim().max(4000, 'Testo troppo lungo (massimo 4000 caratteri).'),
});

export type ContactValues = z.infer<typeof contactSchema>;

/** Corpo della richiesta a /api/contact: dati del modulo + anti-bot */
export const contactRequestSchema = contactSchema.extend({
  /** Token di Cloudflare Turnstile generato dal widget nel browser */
  turnstileToken: z.string().max(2048).optional(),
  /** Honeypot: campo nascosto agli utenti, i bot che compilano tutto lo riempiono */
  website: z.string().max(200).optional(),
});

export const serviceLabel = (value: ServiceId) =>
  serviceOptions.find((option) => option.value === value)?.label ?? value;
