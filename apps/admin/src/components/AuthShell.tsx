import type { ReactNode } from 'react';
import { Card } from '@nzt/ui';
import { usePageHeading } from '../lib/usePageHeading';
import { AdminBanner } from './AdminBanner';
import { Brand } from './Brand';

export function AuthShell({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children?: ReactNode;
}) {
  const headingRef = usePageHeading(title);
  return (
    <div className="bg-technical-grid flex min-h-dvh flex-col">
      <AdminBanner />
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
        </div>
      </main>
    </div>
  );
}
