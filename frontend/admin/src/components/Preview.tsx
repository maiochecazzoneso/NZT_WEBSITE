import type { ReactNode } from 'react';
import { Button, type ButtonProps } from '@nzt/ui';
import { Pill } from './Controls';

/** Etichetta per i contenuti statici dell'anteprima. */
export function SampleLabel() {
  return <Pill tone="strong">Dati di esempio</Pill>;
}

export function SoonBadge() {
  return <Pill>Funzione in arrivo</Pill>;
}

/** Pulsante d'azione disabilitato (funzione non ancora collegata all'API). */
export function SoonButton({ children, ...props }: ButtonProps) {
  return (
    <Button title="Funzione in arrivo" {...props} type="button" disabled aria-disabled="true">
      {children}
    </Button>
  );
}

/** Gruppo di pulsanti disabilitati con un unico badge «Funzione in arrivo». */
export function SoonActions({ children }: { children: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      {children}
      <SoonBadge />
    </div>
  );
}

export function PreviewNotice() {
  return (
    <div
      role="status"
      className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-4 py-3 text-sm text-[var(--text-muted)]"
    >
      <strong className="font-medium text-[var(--text-primary)]">Sezioni in anteprima.</strong>{' '}
      Mostrano dati di esempio e le azioni non sono ancora attive.
    </div>
  );
}

export const th = 'px-4 py-3 font-normal';
export const thead =
  'border-b border-[var(--border-subtle)] font-mono text-xs tracking-widest text-[var(--text-muted)] uppercase';
export const tr = 'border-b border-[var(--border-subtle)] last:border-0';
