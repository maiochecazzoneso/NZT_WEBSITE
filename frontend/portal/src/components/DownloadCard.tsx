import { useEffect, useState } from 'react';
import { Button, Card, buttonVariants } from '@nzt/ui';
import { ApiError } from '../api/http';
import { describeError } from '../api/errors';
import { session } from '../auth/sessionInstance';
import { validateDownloadUrl } from '../lib/safeUrls';
import { LiveRegion } from './LiveRegion';

interface DownloadResponse {
  download_url: string;
  sha256: string;
  version: string;
  expires_in: number;
}

type DownloadState =
  | { phase: 'idle' }
  | { phase: 'loading' }
  | { phase: 'ready'; url: string; sha256: string; version: string; expiresAt: number }
  | { phase: 'expired'; sha256: string; version: string }
  | { phase: 'error'; message: string; entitlement: boolean };

const timeFormat = new Intl.DateTimeFormat('it-IT', {
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
});

function parseDownload(data: DownloadResponse | null, now: number): DownloadState {
  if (
    !data ||
    typeof data.sha256 !== 'string' ||
    !/^[0-9a-f]{64}$/.test(data.sha256) ||
    typeof data.version !== 'string' ||
    typeof data.expires_in !== 'number'
  ) {
    throw new ApiError('invalid-response', 200);
  }
  return {
    phase: 'ready',
    url: validateDownloadUrl(data.download_url),
    sha256: data.sha256,
    version: data.version.slice(0, 32),
    expiresAt: now + data.expires_in * 1000,
  };
}

export function DownloadCard() {
  const [state, setState] = useState<DownloadState>({ phase: 'idle' });
  const [copyStatus, setCopyStatus] = useState<string | null>(null);

  useEffect(() => {
    if (state.phase !== 'ready') return;
    const timer = setTimeout(
      () => setState({ phase: 'expired', sha256: state.sha256, version: state.version }),
      Math.max(0, state.expiresAt - Date.now()),
    );
    return () => clearTimeout(timer);
  }, [state]);

  const prepare = async () => {
    setState({ phase: 'loading' });
    setCopyStatus(null);
    try {
      const response = await session.authorizedFetch<DownloadResponse>({
        method: 'GET',
        path: '/api/v1/downloads/launcher',
      });
      setState(parseDownload(response.data, Date.now()));
    } catch (error) {
      setState({
        phase: 'error',
        message: describeError(error, 'download'),
        entitlement: error instanceof ApiError && error.status === 403,
      });
    }
  };

  const copyHash = async (sha256: string) => {
    try {
      await navigator.clipboard.writeText(sha256);
      setCopyStatus('Impronta SHA-256 copiata negli appunti.');
    } catch {
      setCopyStatus('Copia non riuscita: seleziona e copia il testo manualmente.');
    }
  };

  const details = state.phase === 'ready' || state.phase === 'expired' ? state : null;

  return (
    <Card spotlight className="flex flex-col gap-6" aria-labelledby="launcher-title">
      <div className="flex flex-col gap-2">
        <h2 id="launcher-title" className="text-h3 text-[var(--text-primary)]">
          NZT Launcher
        </h2>
        <p className="text-sm leading-relaxed text-[var(--text-muted)]">
          Il link di download è personale e temporaneo: viene generato su richiesta e scade dopo 5
          minuti.
        </p>
      </div>

      {details ? (
        <dl className="grid gap-4 text-sm">
          <div className="flex flex-col gap-1">
            <dt className="font-mono text-xs tracking-widest text-[var(--text-muted)] uppercase">
              Versione
            </dt>
            <dd className="font-mono text-[var(--text-primary)]" data-testid="launcher-version">
              {details.version}
            </dd>
          </div>
          <div className="flex flex-col gap-1">
            <dt className="font-mono text-xs tracking-widest text-[var(--text-muted)] uppercase">
              SHA-256
            </dt>
            <dd className="flex flex-col gap-2 sm:flex-row sm:items-start">
              <code
                className="font-mono text-xs break-all text-[var(--text-primary)]"
                data-testid="launcher-sha256"
              >
                {details.sha256}
              </code>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="shrink-0 self-start"
                onClick={() => void copyHash(details.sha256)}
              >
                Copia
              </Button>
            </dd>
          </div>
        </dl>
      ) : null}

      {state.phase === 'ready' ? (
        <div className="flex flex-col gap-3">
          <a
            href={state.url}
            rel="noopener noreferrer"
            referrerPolicy="no-referrer"
            className={buttonVariants({
              variant: 'primary',
              size: 'md',
              className: 'w-full sm:w-auto',
            })}
            data-testid="launcher-download"
          >
            Scarica NZT Launcher {state.version}
          </a>
          <p className="text-xs text-[var(--text-muted)]">
            Link valido fino alle {timeFormat.format(state.expiresAt)}.
          </p>
        </div>
      ) : (
        <Button
          type="button"
          variant={state.phase === 'expired' ? 'primary' : 'secondary'}
          className="w-full sm:w-auto sm:self-start"
          onClick={() => void prepare()}
          disabled={state.phase === 'loading'}
          aria-busy={state.phase === 'loading' || undefined}
        >
          {state.phase === 'loading'
            ? 'Preparazione…'
            : state.phase === 'expired'
              ? 'Genera un nuovo link'
              : 'Prepara il download'}
        </Button>
      )}

      <LiveRegion
        tone={state.phase === 'error' && state.entitlement ? 'info' : 'error'}
        message={state.phase === 'error' ? state.message : null}
      />
      <LiveRegion
        tone="info"
        title="Link scaduto"
        message={
          state.phase === 'expired' ? 'Il link di download è scaduto: generane uno nuovo.' : null
        }
      />

      <div className="border-t border-[var(--border-subtle)] pt-4 text-xs leading-relaxed text-[var(--text-muted)]">
        <p>
          Dopo il download verifica che l'impronta SHA-256 del file coincida con quella indicata. Su
          Windows (PowerShell):
        </p>
        <code className="mt-2 block font-mono break-all text-[var(--text-primary)]">
          Get-FileHash .\NZT-Launcher.exe -Algorithm SHA256
        </code>
        <p role="status" className="mt-2 min-h-4">
          {copyStatus}
        </p>
      </div>
    </Card>
  );
}
