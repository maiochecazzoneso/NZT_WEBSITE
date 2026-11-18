// frontend/ui/src/Input.tsx (@nzt/ui) — campo di testo accessibile (architettura tecnica §4).
// Solo token del design system: bordo hairline, focus con bordo speculare + anello bianco (contrasto ≥ 3:1).
// Nessuna transizione: le regole cinetiche ammettono solo transform/opacity (architettura grafica §5.1).
import React from 'react';
import { cn } from './cn';

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  /** Imposta aria-invalid e lo stile di errore (monocromatico: bordo più luminoso, non colore). */
  invalid?: boolean;
  ref?: React.Ref<HTMLInputElement>;
}

export function Input({ className, invalid = false, type = 'text', ...props }: InputProps) {
  return (
    <input
      type={type}
      aria-invalid={invalid || undefined}
      className={cn(
        'block h-11 w-full rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-3.5 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] hover:border-[var(--border-hover)] focus-visible:border-[var(--border-hover)] focus-visible:ring-2 focus-visible:ring-white/40 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-40 aria-[invalid=true]:border-white/60',
        className,
      )}
      {...props}
    />
  );
}
