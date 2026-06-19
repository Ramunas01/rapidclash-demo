import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.js';
// Inter — the v2 app font (self-hosted variable font, bundled by Vite; no runtime CDN).
import '@fontsource-variable/inter';
// Tailwind base + design tokens first, then the existing screen styles layer on top.
// (Foundation only — screens are unchanged in this PR.)
import './index.css';
import './styles.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
