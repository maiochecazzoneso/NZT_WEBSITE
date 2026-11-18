import { useEffect, useState } from 'react';
import { Button } from '@nzt/ui';
import { describeError } from '../api/errors';
import { session } from '../auth/sessionInstance';
import { ME_API, RESEND_VERIFICATION_API, parseAccountInfo } from '../lib/emailVerification';
import { LiveRegion } from './LiveRegion';

type ResendState =
  | { phase: 'idle' }
  | { phase: 'sending' }
  | { phase: 'sent' }
  | { phase: 'error'; message: string };

/**
 * Avviso NON bloccante: l'account funziona anche senza verifica; la verifica decide solo chi
 * controlla l'account se in futuro qualcuno accede con Google usando la stessa email.
 */
export function VerificationNotice() {
  const [email, setEmail] = useState<string | null>(null);
  const [resend, setResend] = useState<ResendState>({ phase: 'idle' });

  useEffect(() => {
    let active = true;
    session
      .authorizedFetch<unknown>({ method: 'GET', path: ME_API })
      .then((response) => {
        const info = parseAccountInfo(response.data);
        if (active && !info.isVerified) setEmail(info.email);
      })
      .catch(() => {
        // Avviso facoltativo: in caso di errore semplicemente non viene mostrato.
      });
    return () => {
      active = false;
    };
  }, []);

  if (email === null) return null;

  const send = async () => {
    setResend({ phase: 'sending' });
    try {
      await session.authorizedFetch<null>({ method: 'POST', path: RESEND_VERIFICATION_API });
      setResend({ phase: 'sent' });
    } catch (error) {
      setResend({ phase: 'error', message: describeError(error, 'resend-verification') });
    }
  };

  return (
    <section
      aria-labelledby="verification-title"
      className="flex flex-col gap-3 rounded-lg border border-[var(--border-subtle)] p-4 sm:flex-row sm:items-center sm:justify-between"
      data-testid="verification-notice"
    >
      <div className="flex flex-col gap-1">
        <h2 id="verification-title" className="text-sm font-medium text-[var(--text-primary)]">
          Email da verificare
        </h2>
        <p className="text-sm leading-relaxed text-[var(--text-muted)]">
          Conferma l'indirizzo <span className="break-all text-[var(--text-primary)]">{email}</span>{' '}
          con il link che ti abbiamo inviato.
        </p>
        <LiveRegion
          tone="info"
          message={resend.phase === 'sent' ? 'Email inviata. Controlla la tua casella.' : null}
        />
        <LiveRegion message={resend.phase === 'error' ? resend.message : null} />
      </div>
      <Button
        type="button"
        variant="secondary"
        size="sm"
        className="shrink-0 self-start sm:self-center"
        onClick={() => void send()}
        disabled={resend.phase === 'sending'}
        aria-busy={resend.phase === 'sending' || undefined}
      >
        {resend.phase === 'sending' ? 'Invio…' : "Invia di nuovo l'email"}
      </Button>
    </section>
  );
}
