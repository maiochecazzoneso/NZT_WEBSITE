// Traduzione degli errori in messaggi italiani generici. Il `detail` del backend serve solo a
// distinguere pochi casi noti; non viene MAI mostrato (niente dettagli interni all'utente).

import { ApiError } from './http';

export type ErrorContext =
  | 'login'
  | 'register'
  | 'google-start'
  | 'google-callback'
  | 'session'
  | 'download'
  | 'logout'
  | 'verify-email'
  | 'resend-verification';

export const DETAIL = {
  invalidCredentials: 'Invalid email or password',
  invalidDpop: 'Invalid DPoP proof',
  accountDisabled: 'Account is disabled',
  googleEmailUnverified: 'Google account email is not verified',
  oauthStateExpired: 'OAuth state expired',
} as const;

export function formatWait(seconds: number): string {
  if (seconds <= 60) return seconds <= 1 ? '1 secondo' : `${seconds} secondi`;
  const minutes = Math.ceil(seconds / 60);
  return minutes === 1 ? '1 minuto' : `${minutes} minuti`;
}

function rateLimited(error: ApiError, context: ErrorContext): string {
  const base =
    context === 'download'
      ? 'Hai raggiunto il limite di richieste di download.'
      : context === 'resend-verification'
        ? "Hai già richiesto più volte l'email di verifica."
        : 'Troppi tentativi in poco tempo.';
  return error.retryAfterSeconds !== null && error.retryAfterSeconds > 0
    ? `${base} Riprova tra ${formatWait(error.retryAfterSeconds)}.`
    : `${base} Attendi qualche minuto e riprova.`;
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
  if (status === 429) return rateLimited(error, context);
  if (status === 503 && error.retryAfterSeconds !== null && error.retryAfterSeconds > 0) {
    // Sovraccarico temporaneo (es. coda di verifica password piena): il server indica l'attesa.
    return `Servizio momentaneamente sovraccarico. Riprova tra ${formatWait(error.retryAfterSeconds)}.`;
  }
  if (status >= 500) return 'Servizio temporaneamente non disponibile. Riprova più tardi.';
  if (status === 401 && detail === DETAIL.invalidDpop) {
    return 'Verifica di sicurezza della richiesta non riuscita. Controlla che data e ora del dispositivo siano corrette, poi riprova.';
  }

  switch (context) {
    case 'login':
      if (status === 401) return 'Email o password non corretti.';
      if (status === 422) return 'Inserisci un indirizzo email valido e la password.';
      break;
    case 'register':
      if (status === 400) {
        return 'Registrazione non riuscita. Verifica i dati inseriti oppure accedi se hai già un account.';
      }
      if (status === 422) {
        return "Controlla l'email e la password: non rispettano i requisiti indicati.";
      }
      break;
    case 'google-start':
      if (status === 503) return "L'accesso con Google non è al momento disponibile.";
      break;
    case 'google-callback':
      if (status === 403 && detail === DETAIL.accountDisabled) {
        return 'Questo account è disabilitato. Contatta NZT Solutions.';
      }
      if (status === 403) return 'Accesso con Google non consentito per questo account.';
      if (status === 409) {
        return "Questo account è già collegato a un'altra identità Google.";
      }
      if (status === 400 && detail === DETAIL.googleEmailUnverified) {
        return "L'email del tuo account Google non risulta verificata.";
      }
      if (status === 400) {
        return 'La richiesta di accesso con Google non è valida o è scaduta. Riprova.';
      }
      break;
    case 'session':
      if (status === 401) return 'La sessione è scaduta. Accedi di nuovo.';
      break;
    case 'download':
      if (status === 403) {
        return 'Il tuo account non ha una licenza attiva per NZT Launcher.';
      }
      if (status === 401) return 'La sessione è scaduta. Accedi di nuovo.';
      break;
    case 'logout':
      break;
    case 'verify-email':
      // Token sconosciuto, già usato, scaduto o manomesso: un unico messaggio generico.
      if (status === 400 || status === 422) {
        return 'Il link di verifica non è valido o è scaduto. Accedi e richiedi una nuova email.';
      }
      break;
    case 'resend-verification':
      if (status === 401) return 'La sessione è scaduta. Accedi di nuovo.';
      break;
  }
  return 'Richiesta non riuscita. Riprova.';
}
