import { useState } from 'react';
import { Button, Card } from '@nzt/ui';
import { session } from '../auth/sessionInstance';
import { Brand } from '../components/Brand';
import { DownloadCard } from '../components/DownloadCard';
import { VerificationNotice } from '../components/VerificationNotice';
import { usePageHeading } from '../lib/usePageHeading';

export function DashboardPage() {
  const headingRef = usePageHeading('Dashboard');
  const [leaving, setLeaving] = useState(false);

  const logout = async () => {
    setLeaving(true);
    await session.logout();
  };

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="border-b border-[var(--border-subtle)] bg-[var(--bg-glass)]">
        <div className="mx-auto flex h-16 w-full max-w-5xl items-center justify-between px-4 sm:px-6">
          <Brand />
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => void logout()}
            disabled={leaving}
            aria-busy={leaving || undefined}
          >
            {leaving ? 'Uscita…' : 'Esci'}
          </Button>
        </div>
      </header>
      <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-8 px-4 py-10 sm:px-6">
        <div className="flex flex-col gap-2">
          <h1
            ref={headingRef}
            tabIndex={-1}
            className="text-metallic w-fit text-h2 focus:outline-none"
          >
            Area Clienti
          </h1>
        </div>
        <VerificationNotice />
        <div className="grid gap-6 lg:grid-cols-[1fr_2fr]">
          <Card
            spotlight={false}
            className="flex flex-col gap-3 lg:self-start"
            aria-labelledby="session-title"
          >
            <h2 id="session-title" className="text-h3 text-[var(--text-primary)]">
              Sessione
            </h2>
            <p
              className="flex items-center gap-2 text-sm text-[var(--text-primary)]"
              data-testid="session-state"
            >
              <span aria-hidden="true" className="h-2 w-2 rounded-full bg-white" />
              Accesso effettuato
            </p>
            <p className="text-sm leading-relaxed text-[var(--text-muted)]">
              La sessione è legata a questo browser da una chiave crittografica non esportabile e si
              rinnova automaticamente. Usa “Esci” sui dispositivi condivisi.
            </p>
          </Card>
          <DownloadCard />
        </div>
      </main>
    </div>
  );
}
