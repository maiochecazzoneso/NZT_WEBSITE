import { useEffect, useState } from 'react';
import { apiFetch } from '../api/http';
import { describeError } from '../api/errors';
import { useSession } from '../auth/useSession';
import { AuthShell } from '../components/AuthShell';
import { LiveRegion } from '../components/LiveRegion';
import { createVerificationLinkConsumer, submitVerificationToken } from '../lib/emailVerification';
import { Link } from '../lib/router';

let consumeLink = createVerificationLinkConsumer();
let completion: Promise<string | null> | null = null;

/** Una sola POST per caricamento pagina (anche con il doppio effetto di React StrictMode). */
function verifyOnce(): Promise<string | null> {
  completion ??= (async () => {
    const result = consumeLink(window.location, window.history);
    if (result.type === 'missing') {
      return 'Il link di verifica non è valido o è scaduto. Accedi e richiedi una nuova email.';
    }
    try {
      await submitVerificationToken(apiFetch, result.token);
      return null;
    } catch (error) {
      return describeError(error, 'verify-email');
    }
  })();
  return completion;
}

/** Un nuovo link aperto nella stessa scheda cambia solo il frammento (nessun ricaricamento). */
function resetForNewLink(): boolean {
  if (!window.location.hash) return false;
  consumeLink = createVerificationLinkConsumer();
  completion = null;
  return true;
}

export function VerifyEmailPage() {
  const { status } = useSession();
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  useEffect(() => {
    let active = true;
    const run = () => {
      void verifyOnce().then((message) => {
        if (!active) return;
        setDone(true);
        setError(message);
      });
    };
    const onHashChange = () => {
      if (!resetForNewLink()) return;
      setDone(false);
      setError(null);
      run();
    };
    window.addEventListener('hashchange', onHashChange);
    run();
    return () => {
      active = false;
      window.removeEventListener('hashchange', onHashChange);
    };
  }, []);

  const authenticated = status === 'authenticated';
  return (
    <AuthShell title="Verifica email">
      {!done ? (
        <p role="status" className="text-sm text-[var(--text-muted)]">
          Verifica in corso…
        </p>
      ) : null}
      <LiveRegion tone="success" message={done && !error ? 'Indirizzo email verificato.' : null} />
      <LiveRegion message={error} />
      {done ? (
        <p className="mt-6 text-sm">
          <Link
            to={authenticated ? '/' : '/accedi'}
            className="font-medium text-[var(--text-primary)] underline underline-offset-4"
            data-testid="verify-email-continue"
          >
            {authenticated ? "Vai all'Area Clienti" : 'Vai all’accesso'}
          </Link>
        </p>
      ) : null}
    </AuthShell>
  );
}
