import { PageHeader } from '../components/PageHeader';
import { Link } from '../lib/router';

export function NotFoundPage() {
  return (
    <>
      <PageHeader title="Pagina non trovata" description="L'indirizzo richiesto non esiste." />
      <Link
        to="/"
        className="w-fit text-sm font-medium text-[var(--text-primary)] underline underline-offset-4"
      >
        Torna alla dashboard
      </Link>
    </>
  );
}
