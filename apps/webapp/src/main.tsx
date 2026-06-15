/**
 * Entry point. Initializes the Telegram SDK (ready + expand) BEFORE mounting
 * React so the auth flow can read initData synchronously from the cached
 * context. Then renders the App shell.
 */
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import App from './App';
import { I18nProvider } from './i18n';
import { initTelegram } from './telegram';
import './styles.css';

async function bootstrap() {
  await initTelegram();

  const rootEl = document.getElementById('root');
  if (!rootEl) throw new Error('#root not found');

  createRoot(rootEl).render(
    <StrictMode>
      <I18nProvider>
        <App />
      </I18nProvider>
    </StrictMode>,
  );
}

void bootstrap();
