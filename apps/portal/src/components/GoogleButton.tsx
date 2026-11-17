import { useState } from 'react';
import { Button } from '@nzt/ui';
import { apiFetch } from '../api/http';
import { describeError } from '../api/errors';
import { OAUTH_AUTHORIZE_ORIGINS } from '../config';
import { validateAuthorizationUrl } from '../lib/safeUrls';

interface AuthorizeResponse {
  authorization_url: string;
}

/** Avvia il flusso OIDC: il backend imposta il cookie di stato e restituisce l'URL Google. */
export function GoogleButton({ onError }: { onError: (message: string | null) => void }) {
  const [pending, setPending] = useState(false);

  const start = async () => {
    onError(null);
    setPending(true);
    try {
      const response = await apiFetch<AuthorizeResponse>({
        method: 'GET',
        path: '/api/v1/auth/google/authorize',
        withCredentials: true,
      });
      const target = validateAuthorizationUrl(
        response.data?.authorization_url,
        OAUTH_AUTHORIZE_ORIGINS,
      );
      window.location.assign(target);
    } catch (error) {
      onError(
        error instanceof Error && error.name !== 'ApiError'
          ? "Impossibile avviare l'accesso con Google. Riprova."
          : describeError(error, 'google-start'),
      );
      setPending(false);
    }
  };

  return (
    <Button
      type="button"
      variant="secondary"
      className="w-full"
      onClick={() => void start()}
      disabled={pending}
      aria-busy={pending || undefined}
    >
      <svg aria-hidden="true" viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor">
        <path d="M21.35 11.1h-9.17v2.98h5.27c-.23 1.4-1.66 4.1-5.27 4.1-3.17 0-5.76-2.63-5.76-5.87s2.59-5.87 5.76-5.87c1.8 0 3.01.77 3.7 1.43l2.52-2.43C16.78 3.96 14.68 3 12.18 3 7.15 3 3.08 7.03 3.08 12.31s4.07 9.31 9.1 9.31c5.25 0 8.73-3.69 8.73-8.89 0-.6-.07-1.06-.16-1.63z" />
      </svg>
      {pending ? 'Reindirizzamento…' : 'Accedi con Google'}
    </Button>
  );
}
