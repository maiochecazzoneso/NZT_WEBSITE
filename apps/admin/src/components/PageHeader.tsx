import type { ReactNode } from 'react';
import { usePageHeading } from '../lib/usePageHeading';

export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
}) {
  const ref = usePageHeading(title);
  return (
    <div className="flex flex-wrap items-end justify-between gap-4">
      <div className="flex flex-col gap-1.5">
        <h1 ref={ref} tabIndex={-1} className="text-metallic w-fit text-h2 focus:outline-none">
          {title}
        </h1>
        {description ? (
          <p className="max-w-2xl text-sm leading-relaxed text-[var(--text-muted)]">
            {description}
          </p>
        ) : null}
      </div>
      {actions}
    </div>
  );
}
