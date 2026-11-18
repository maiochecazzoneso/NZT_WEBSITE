// frontend/ui/src/Field.tsx (@nzt/ui) — etichetta + suggerimento + errore collegati al controllo.
// Centralizza il cablaggio WCAG (label/for, aria-describedby, aria-invalid) per ogni campo dei form.
import React from 'react';
import { cn } from './cn';

export interface FieldControlProps {
  id: string;
  'aria-describedby'?: string;
  invalid: boolean;
}

export interface FieldProps {
  id: string;
  label: string;
  hint?: React.ReactNode;
  error?: string | null;
  className?: string;
  children: (control: FieldControlProps) => React.ReactNode;
}

export function Field({ id, label, hint, error, className, children }: FieldProps) {
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [hintId, errorId].filter(Boolean).join(' ') || undefined;
  return (
    <div className={cn('flex flex-col gap-2', className)}>
      <label htmlFor={id} className="text-sm font-medium text-[var(--text-primary)]">
        {label}
      </label>
      {children({ id, 'aria-describedby': describedBy, invalid: Boolean(error) })}
      {hint ? (
        <div id={hintId} className="text-xs leading-relaxed text-[var(--text-muted)]">
          {hint}
        </div>
      ) : null}
      {error ? (
        <p id={errorId} className="text-xs font-medium text-[var(--text-primary)]">
          <span aria-hidden="true">✕ </span>
          {error}
        </p>
      ) : null}
    </div>
  );
}
