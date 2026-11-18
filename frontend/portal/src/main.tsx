import '@fontsource/geist-sans/400.css';
import '@fontsource/geist-sans/500.css';
import '@fontsource/geist-sans/600.css';
import '@fontsource/geist-mono/latin-400.css';
import './index.css';

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app/App';
import { session } from './auth/sessionInstance';
import { GOOGLE_CALLBACK_PATH } from './lib/oauthCallback';
import { normalizePath } from './lib/router';

const container = document.getElementById('root');
if (!container) throw new Error('Missing #root');

// Ripristino silenzioso della sessione al caricamento (reload incluso). Sul callback Google la
// sessione viene invece creata dal callback stesso: niente refresh in parallelo.
void session.start({ restore: normalizePath(window.location.pathname) !== GOOGLE_CALLBACK_PATH });

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && session.needsEarlyRefresh()) void session.refresh();
});

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
