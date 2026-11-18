import type { ReactNode } from 'react';
import { Alert } from '@nzt/ui';

/**
 * Regione live SEMPRE montata: quando `message` cambia il testo viene annunciato dagli screen reader
 * (role="alert" per gli errori, role="status" per le informazioni).
 */
export function LiveRegion({
  message,
  tone = 'error',
  title,
  className,
  children,
}: {
  message: string | null;
  tone?: 'error' | 'info' | 'success';
  title?: string;
  className?: string;
  children?: ReactNode;
}) {
  return (
    <div role={tone === 'error' ? 'alert' : 'status'} aria-atomic="true" className={className}>
      {message ? (
        <Alert tone={tone} {...(title ? { title } : {})}>
          {message}
          {children}
        </Alert>
      ) : null}
    </div>
  );
}
