import { useEffect, useState, type ReactNode } from 'react';
import { Button } from '@nzt/ui';
import { describeError } from '../api/errors';
import { adminApi, session } from '../auth/sessionInstance';
import { Link, usePathname } from '../lib/router';
import { AdminBanner } from './AdminBanner';
import { Brand } from './Brand';
import { PreviewNotice } from './Preview';

export const ROUTES = {
  dashboard: '/',
  login: '/accedi',
  customers: '/clienti',
  downloads: '/download',
  campaigns: '/campagne',
  audit: '/audit',
} as const;

const NAV = [
  { to: ROUTES.dashboard, label: 'Dashboard' },
  { to: ROUTES.customers, label: 'Clienti' },
  { to: ROUTES.downloads, label: 'Download' },
  { to: ROUTES.campaigns, label: 'Campagne' },
  { to: ROUTES.audit, label: 'Audit log' },
] as const;

export function AdminShell({ children }: { children: ReactNode }) {
  const path = usePathname();
  const [leaving, setLeaving] = useState(false);
  const [email, setEmail] = useState<string | null>(null);
  const [meError, setMeError] = useState<string | null>(null);

  // Unica chiamata di rete delle pagine per ora: identità dell'admin (GET /api/v1/admin/me).
  useEffect(() => {
    let active = true;
    adminApi
      .me()
      .then((me) => {
        if (active) setEmail(me.email);
      })
      .catch((error: unknown) => {
        if (active) setMeError(describeError(error, 'load'));
      });
    return () => {
      active = false;
    };
  }, []);

  // Logout reale: revoca il refresh token, elimina la chiave DPoP; la guardia riporta a /accedi.
  const logout = async () => {
    setLeaving(true);
    await session.logout();
  };

  return (
    <div className="flex min-h-dvh flex-col">
      <AdminBanner />
      <div className="flex flex-1 flex-col md:flex-row">
        <aside className="border-b border-[var(--border-subtle)] bg-[var(--bg-glass)] md:sticky md:top-0 md:h-[calc(100dvh-2rem)] md:w-60 md:shrink-0 md:self-start md:border-r md:border-b-0">
          <div className="flex h-16 items-center justify-between px-4 md:h-20 md:px-6">
            <Brand />
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="md:hidden"
              onClick={() => void logout()}
              disabled={leaving}
            >
              {leaving ? 'Uscita…' : 'Esci'}
            </Button>
          </div>
          <nav aria-label="Sezioni" className="px-2 pb-3 md:px-3">
            <ul className="flex gap-1 overflow-x-auto md:flex-col">
              {NAV.map((item) => {
                const current = item.to === path;
                return (
                  <li key={item.to} className="shrink-0">
                    <Link
                      to={item.to}
                      {...(current ? { 'aria-current': 'page' as const } : {})}
                      className={`block rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                        current
                          ? 'bg-white/10 text-[var(--text-primary)]'
                          : 'text-[var(--text-muted)] hover:bg-white/[0.04] hover:text-[var(--text-primary)]'
                      }`}
                    >
                      {item.label}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </nav>
          <div className="hidden flex-col gap-3 border-t border-[var(--border-subtle)] p-4 md:flex">
            <p
              className="font-mono text-xs break-all text-[var(--text-muted)]"
              data-testid="admin-email"
            >
              {email ?? meError ?? '…'}
            </p>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => void logout()}
              disabled={leaving}
              aria-busy={leaving || undefined}
            >
              {leaving ? 'Uscita…' : 'Esci'}
            </Button>
          </div>
        </aside>
        <main className="mx-auto flex w-full max-w-6xl min-w-0 flex-1 flex-col gap-8 px-4 py-8 sm:px-6 md:py-10">
          <PreviewNotice />
          {children}
        </main>
      </div>
    </div>
  );
}
