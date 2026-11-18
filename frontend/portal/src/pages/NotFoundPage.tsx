import { AuthShell } from '../components/AuthShell';
import { Link } from '../lib/router';

export function NotFoundPage() {
  return (
    <AuthShell title="Pagina non trovata" description="L'indirizzo richiesto non esiste.">
      <Link
        to="/"
        className="text-sm font-medium text-[var(--text-primary)] underline underline-offset-4"
      >
        Vai all'Area Clienti
      </Link>
    </AuthShell>
  );
}
