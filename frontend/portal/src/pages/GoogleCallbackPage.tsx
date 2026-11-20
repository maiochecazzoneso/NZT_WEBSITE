import { useEffect, useState } from 'react';
import { describeError } from '../api/errors';
import { session } from '../auth/sessionInstance';
import { AuthShell } from '../components/AuthShell';
import { LiveRegion } from '../components/LiveRegion';
import { createOAuthCallbackConsumer } from '../lib/oauthCallback';
import { Link, navigate } from '../lib/router';

const consumeCallback = createOAuthCallbackConsumer();
let completion: Promise<string | null> | null = null;

/** Una sola POST per caricamento pagina (anche con il doppio effetto di React StrictMode). */
function completeOnce(): Promise<string | null> {
  completion ??= (async () => {
    const result = consumeCallback(window.location, window.history);
    if (result.type === 'error') {
      return result.error === 'access_denied'
        ? 'Accesso con Google annullato.'
        : 'Google non ha completato l’accesso. Riprova.';
    }
    if (result.type === 'missing') return 'Nessuna richiesta di accesso con Google in corso.';
    try {
      await session.completeGoogleSignIn(result.code, result.state);
      return null;
    } catch (error) {
      return describeError(error, 'google-callback');
    }
  })();
  return completion;
}

export function GoogleCallbackPage() {
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  useEffect(() => {
    let active = true;
    void completeOnce().then((message) => {
      if (!active) return;
      setDone(true);
      if (message) setError(message);
      else navigate('/', { replace: true });
    });
    return () => {
      active = false;
    };
  }, []);

  return (
    <AuthShell title="Accesso con Google">
      {!done ? (
        <p role="status" className="text-sm text-[var(--text-muted)]">
          Verifica in corso…
        </p>
      ) : null}
      <LiveRegion message={error} />
      {error ? (
        <p className="mt-6 text-sm">
          <Link
            to="/accedi"
            className="font-medium text-[var(--text-primary)] underline underline-offset-4"
          >
            Torna all'accesso
          </Link>
        </p>
      ) : null}
    </AuthShell>
  );
}
