import { describeError, type ErrorContext } from '../api/errors';
import { LiveRegion } from './LiveRegion';

/** Regione live per un errore API (sempre montata). 401 è gestito dalla sessione (-> login). */
export function ErrorNotice({
  error,
  context = 'load',
  className,
}: {
  error: unknown;
  context?: ErrorContext;
  className?: string;
}) {
  return (
    <LiveRegion
      message={error ? describeError(error, context) : null}
      {...(className ? { className } : {})}
    />
  );
}
