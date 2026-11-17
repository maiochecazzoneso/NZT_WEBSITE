import { useSession } from '../auth/useSession';
import { LoadingScreen } from '../components/LoadingScreen';
import { GOOGLE_CALLBACK_PATH } from '../lib/oauthCallback';
import { Redirect, usePathname } from '../lib/router';
import { DashboardPage } from '../pages/DashboardPage';
import { GoogleCallbackPage } from '../pages/GoogleCallbackPage';
import { LoginPage } from '../pages/LoginPage';
import { NotFoundPage } from '../pages/NotFoundPage';
import { RegisterPage } from '../pages/RegisterPage';

export const ROUTES = {
  dashboard: '/',
  login: '/accedi',
  register: '/registrazione',
  googleCallback: GOOGLE_CALLBACK_PATH,
} as const;

export function App() {
  const path = usePathname();
  const { status } = useSession();

  switch (path) {
    case ROUTES.dashboard:
      // Rotta protetta: senza sessione si va all'accesso.
      if (status === 'loading') return <LoadingScreen />;
      return status === 'authenticated' ? <DashboardPage /> : <Redirect to={ROUTES.login} />;
    case ROUTES.login:
    case ROUTES.register:
      if (status === 'loading') return <LoadingScreen />;
      if (status === 'authenticated') return <Redirect to={ROUTES.dashboard} />;
      return path === ROUTES.login ? <LoginPage /> : <RegisterPage />;
    case ROUTES.googleCallback:
      return <GoogleCallbackPage />;
    default:
      return <NotFoundPage />;
  }
}
