// Traduzione degli errori in messaggi italiani. A differenza del portale clienti, qui l'utente è
// un amministratore: per i conflitti (409) il `detail` del backend è la spiegazione utile
// ("non in bozza", "marketing disabilitato in produzione", "non puoi disattivare te stesso"…)
// e viene mostrato. Per tutto il resto il `detail` resta interno.

import { ApiError } from './http';

export type ErrorContext = 'login' | 'session' | 'load' | 'action';

export const DETAIL = {
  invalidCredentials: 'Invalid email or password',
  invalidDpop: 'Invalid DPoP proof',
} as const;

export function formatWait(seconds: number): string {
  if (seconds <= 60) return seconds <= 1 ? '1 secondo' : `${seconds} secondi`;
  const minutes = Math.ceil(seconds / 60);
  return minutes === 1 ? '1 minuto' : `${minutes} minuti`;
}

export function isUnauthorized(error: unknown): boolean {
  return error instanceof ApiError && error.kind === 'http' && error.status === 401;
}

export function describeError(error: unknown, context: ErrorContext): string {
  if (!(error instanceof ApiError)) {
    return 'Si è verificato un errore imprevisto. Ricarica la pagina e riprova.';
  }
  if (error.kind === 'network') {
    return 'Impossibile contattare il server. Controlla la connessione e riprova.';
  }
  if (error.kind === 'timeout') {
    return 'Il server non ha risposto in tempo. Riprova tra qualche istante.';
  }
  if (error.kind === 'invalid-response') {
    return 'Risposta del server non valida. Riprova più tardi.';
  }
  const { status, detail } = error;
  if (status === 429) {
    return error.retryAfterSeconds !== null && error.retryAfterSeconds > 0
      ? `Troppe richieste in poco tempo. Riprova tra ${formatWait(error.retryAfterSeconds)}.`
      : 'Troppe richieste in poco tempo. Attendi qualche minuto e riprova.';
  }
  if (status === 503 && error.retryAfterSeconds !== null && error.retryAfterSeconds > 0) {
    return `Servizio momentaneamente sovraccarico. Riprova tra ${formatWait(error.retryAfterSeconds)}.`;
  }
  if (status >= 500) return 'Servizio temporaneamente non disponibile. Riprova più tardi.';
  if (status === 401 && detail === DETAIL.invalidDpop) {
    return 'Verifica di sicurezza della richiesta non riuscita. Controlla che data e ora del dispositivo siano corrette, poi riprova.';
  }
  if (status === 401) {
    return context === 'login'
      ? 'Credenziali non valide.'
      : 'La sessione è scaduta. Accedi di nuovo.';
  }
  if (status === 403) return 'Non hai i permessi di amministratore per questa operazione.';
  if (status === 409) {
    return detail
      ? `Operazione non consentita: ${detail.replace(/[.\s]+$/, '')}.`
      : 'Operazione non consentita in questo momento.';
  }
  if (status === 404) return 'Elemento non trovato: aggiorna la pagina e riprova.';
  if (status === 422 || status === 400) {
    return context === 'login'
      ? 'Inserisci un indirizzo email valido e la password.'
      : 'I dati inseriti non sono validi. Controlla i campi e riprova.';
  }
  return 'Richiesta non riuscita. Riprova.';
}
