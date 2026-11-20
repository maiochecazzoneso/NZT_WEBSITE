// src/lib/contact-schema.ts — schema del modulo contatti condiviso tra client (ContactForm.tsx) e server
// (/api/contact): la validazione lato browser è una cortesia, quella che conta è la stessa ripetuta sul server.
// Regole di sicurezza (docs/architettura_sicurezza_nzt_solutions.md §3.1):
// - oggetti "strict": una chiave non prevista fa fallire la validazione (anti mass-assignment)
// - solo scalari tipizzati, con lunghezza massima
// - niente caratteri di controllo nei campi a riga singola (finiscono nell'oggetto dell'email)
import { z } from '@/lib/zod';
import { serviceOptions, type ServiceId } from '@/content/service-options';

export const serviceValues = serviceOptions.map((option) => option.value) as [
  ServiceId,
  ...ServiceId[],
];

/* eslint-disable no-control-regex -- i caratteri di controllo sono esattamente ciò che va escluso */
/** Qualsiasi carattere di controllo (comprese nuove righe e tabulazioni) */
const CONTROL_CHARS = /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/;
/** Caratteri di controllo esclusi a capo e tabulazione, ammessi nel messaggio */
const CONTROL_CHARS_MULTILINE = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/;
/* eslint-enable no-control-regex */

const singleLine = (value: string) => !CONTROL_CHARS.test(value);

export const contactSchema = z.strictObject({
  name: z
    .string()
    .trim()
    .min(2, 'Inserisci nome e cognome.')
    .max(120, 'Nome troppo lungo.')
    .refine(singleLine, 'Il nome contiene caratteri non ammessi.'),
  email: z
    .string()
    .trim()
    .max(254, 'Indirizzo email troppo lungo.')
    .pipe(z.email('Inserisci un indirizzo email valido.')),
  company: z
    .string()
    .trim()
    .min(2, 'Indica l’azienda o lo studio.')
    .max(160, 'Nome troppo lungo.')
    .refine(singleLine, 'Il nome contiene caratteri non ammessi.'),
  phone: z
    .string()
    .trim()
    .max(40, 'Numero non valido.')
    .regex(/^$|^[+\d][\d\s./-]{5,}$/, 'Numero non valido.')
    .refine(singleLine, 'Numero non valido.')
    .optional(),
  service: z.enum(serviceValues),
  // Facoltativo per il nuovo copy: chi scrive poco non va bloccato
  message: z
    .string()
    .trim()
    .max(4000, 'Testo troppo lungo (massimo 4000 caratteri).')
    .refine(
      (value) => !CONTROL_CHARS_MULTILINE.test(value),
      'Il testo contiene caratteri non ammessi.',
    ),
});

export type ContactValues = z.infer<typeof contactSchema>;

/** Corpo della richiesta a /api/contact: dati del modulo + anti-bot */
export const contactRequestSchema = z.strictObject({
  ...contactSchema.shape,
  /** Token di Cloudflare Turnstile generato dal widget nel browser */
  turnstileToken: z.string().min(1).max(2048).optional(),
  /** Honeypot: campo nascosto agli utenti, i bot che compilano tutto lo riempiono */
  website: z.string().max(200).optional(),
});

export type ContactRequest = z.infer<typeof contactRequestSchema>;

export const serviceLabel = (value: ServiceId) =>
  serviceOptions.find((option) => option.value === value)?.label ?? value;
