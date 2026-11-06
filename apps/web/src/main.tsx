import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { App } from './app/app';
import { initPreferences } from './lib/preferences/preferences';
import { initPwa } from './lib/pwa';
import { ensureRandomUuid } from './lib/random-uuid';
import './styles.css';

ensureRandomUuid();
initPreferences();
// Installable app + Web Push (T-190): the service worker and the install prompt.
initPwa();

const root = document.getElementById('root');
if (!root) throw new Error('#root not found');
createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
