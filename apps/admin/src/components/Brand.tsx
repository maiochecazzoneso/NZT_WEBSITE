import { Badge } from '@nzt/ui';

export function Brand() {
  return (
    <div className="flex items-center gap-3">
      <span className="text-sm font-semibold tracking-tight text-[var(--text-primary)]">
        NZT Solutions
      </span>
      <Badge variant="primary" className="px-2.5 py-1">
        Admin
      </Badge>
    </div>
  );
}
