// packages/ui/src/Alert.tsx (@nzt/ui) — riquadro messaggio monocromatico (errore / info / esito).
// Puramente presentazionale: l'annuncio agli screen reader è responsabilità della regione live
// sempre montata del consumer (role="alert" / role="status"), così il messaggio viene letto anche
// quando il riquadro compare dopo il primo render.
import React from 'react';
import { cn } from './cn';

export interface AlertProps extends React.HTMLAttributes<HTMLDivElement> {
  tone?: 'error' | 'info' | 'success';
  title?: string;
}

const prefix: Record<NonNullable<AlertProps['tone']>, string> = {
  error: 'Errore',
  info: 'Info',
  success: 'Fatto',
};

export function Alert({ tone = 'info', title, className, children, ...props }: AlertProps) {
  return (
    <div
      className={cn(
        'rounded-lg border px-4 py-3 text-sm leading-relaxed',
        tone === 'error'
          ? 'border-white/40 bg-[var(--bg-surface-elevated)] text-[var(--text-primary)]'
          : 'border-[var(--border-subtle)] bg-[var(--bg-surface)] text-[var(--text-muted)]',
        className,
      )}
      {...props}
    >
      <p className="font-mono text-xs tracking-widest text-[var(--text-primary)] uppercase">
        {title ?? prefix[tone]}
      </p>
      <div className="mt-1">{children}</div>
    </div>
  );
}
