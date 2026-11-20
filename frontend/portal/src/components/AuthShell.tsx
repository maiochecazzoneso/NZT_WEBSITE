import type { ReactNode } from 'react';
import { Card } from '@nzt/ui';
import { usePageHeading } from '../lib/usePageHeading';
import { Brand, SITE_URL } from './Brand';

interface AuthShellProps {
  title: string;
  description?: string;
  children: ReactNode;
  footer?: ReactNode;
}

export function AuthShell({ title, description, children, footer }: AuthShellProps) {
  const headingRef = usePageHeading(title);
  return (
    <div className="bg-technical-grid flex min-h-dvh flex-col">
      <header className="mx-auto flex w-full max-w-5xl items-center justify-between px-4 py-5 sm:px-6">
        <Brand />
      </header>
      <main className="flex flex-1 justify-center px-4 pt-4 pb-16 sm:items-center sm:px-6">
        <div className="w-full max-w-md">
          <Card spotlight={false} className="p-6 sm:p-8">
            <h1
              ref={headingRef}
              tabIndex={-1}
              className="text-h3 text-[var(--text-primary)] focus:outline-none"
            >
              {title}
            </h1>
            {description ? (
              <p className="mt-2 text-sm leading-relaxed text-[var(--text-muted)]">{description}</p>
            ) : null}
            <div className="mt-8">{children}</div>
          </Card>
          {footer ? (
            <div className="mt-6 text-center text-sm text-[var(--text-muted)]">{footer}</div>
          ) : null}
        </div>
      </main>
      <footer className="px-4 pb-6 text-center text-xs text-[var(--text-muted)] sm:px-6">
        <a
          href={SITE_URL}
          className="underline-offset-4 hover:text-[var(--text-primary)] hover:underline"
        >
          nztsolutions.it
        </a>
      </footer>
    </div>
  );
}
