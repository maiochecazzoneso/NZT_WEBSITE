// Controlli nativi con lo stesso aspetto dei campi di @nzt/ui (che non ha select/textarea/checkbox).

import type {
  InputHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
} from 'react';
import { cn } from '@nzt/ui';

const fieldBase =
  'block w-full rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-3.5 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] hover:border-[var(--border-hover)] focus-visible:border-[var(--border-hover)] focus-visible:ring-2 focus-visible:ring-white/40 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-40 aria-[invalid=true]:border-white/60';

export function Select({
  className,
  invalid,
  ...props
}: SelectHTMLAttributes<HTMLSelectElement> & { invalid?: boolean }) {
  return (
    <select
      aria-invalid={invalid || undefined}
      className={cn(fieldBase, 'h-11', className)}
      {...props}
    />
  );
}

export function Textarea({
  className,
  invalid,
  ...props
}: TextareaHTMLAttributes<HTMLTextAreaElement> & { invalid?: boolean }) {
  return (
    <textarea
      aria-invalid={invalid || undefined}
      className={cn(fieldBase, 'min-h-40 py-3 leading-relaxed', className)}
      {...props}
    />
  );
}

export function Checkbox({
  label,
  className,
  ...props
}: Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> & { label: ReactNode }) {
  return (
    <label className={cn('flex cursor-pointer items-center gap-2.5 text-sm', className)}>
      <input
        type="checkbox"
        className="h-4 w-4 cursor-pointer accent-white focus-visible:ring-2 focus-visible:ring-white/40 focus-visible:outline-none"
        {...props}
      />
      <span className="text-[var(--text-primary)]">{label}</span>
    </label>
  );
}

export function Pill({
  children,
  tone = 'muted',
}: {
  children: ReactNode;
  tone?: 'muted' | 'strong';
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full border px-2 py-0.5 font-mono text-[11px] tracking-wider uppercase',
        tone === 'strong'
          ? 'border-white/40 text-[var(--text-primary)]'
          : 'border-[var(--border-subtle)] text-[var(--text-muted)]',
      )}
    >
      {children}
    </span>
  );
}
