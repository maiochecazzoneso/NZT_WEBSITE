// Login e sessione reali (DPoP, src/auth); le sezioni sono per ora interfacce con dati di esempio
// e non effettuano chiamate di rete (tranne GET /me nella barra laterale).

import { useSession } from '../auth/useSession';
import { AdminShell, ROUTES } from '../components/AdminShell';
import { LoadingScreen } from '../components/LoadingScreen';
import { Redirect, usePathname } from '../lib/router';
import { AuditPage } from '../pages/AuditPage';
import { CampaignsPage } from '../pages/CampaignsPage';
import { CustomersPage } from '../pages/CustomersPage';
import { DashboardPage } from '../pages/DashboardPage';
import { DownloadsPage } from '../pages/DownloadsPage';
import { LoginPage } from '../pages/LoginPage';
import { NotFoundPage } from '../pages/NotFoundPage';

function page(path: string) {
  switch (path) {
    case ROUTES.dashboard:
      return <DashboardPage />;
    case ROUTES.customers:
      return <CustomersPage />;
    case ROUTES.downloads:
      return <DownloadsPage />;
    case ROUTES.campaigns:
      return <CampaignsPage />;
    case ROUTES.audit:
      return <AuditPage />;
    default:
      return <NotFoundPage />;
  }
}

export function App() {
  const path = usePathname();
  const { status } = useSession();

  if (status === 'loading') return <LoadingScreen />;
  if (path === ROUTES.login) {
    return status === 'authenticated' ? <Redirect to={ROUTES.dashboard} /> : <LoginPage />;
  }
  // Guardia di route: senza sessione (o a sessione scaduta) si va all'accesso.
  if (status !== 'authenticated') return <Redirect to={ROUTES.login} />;
  return <AdminShell>{page(path)}</AdminShell>;
}
