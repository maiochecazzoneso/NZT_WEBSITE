import { Badge } from '@nzt/ui';

export const SITE_URL = 'https://nztsolutions.it';

export function Brand() {
  return (
    <div className="flex items-center gap-3">
      <a
        href={SITE_URL}
        className="rounded-sm text-sm font-semibold tracking-tight text-[var(--text-primary)]"
      >
        NZT Solutions
      </a>
      <Badge variant="muted" className="px-2.5 py-1">
        Area Clienti
      </Badge>
    </div>
  );
}
