import '@fontsource/geist-sans/latin-400.css';
import '@fontsource/geist-sans/latin-500.css';
import '@fontsource/geist-sans/latin-600.css';
import '@fontsource/geist-mono/latin-400.css';
import './index.css';

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app/App';
import { session } from './auth/sessionInstance';

const container = document.getElementById('root');
if (!container) throw new Error('Missing #root');

// Ripristino silenzioso della sessione al caricamento (reload incluso).
void session.start();

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && session.needsEarlyRefresh()) void session.refresh();
});

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
