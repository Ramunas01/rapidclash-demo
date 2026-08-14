import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';
import { App } from './App.js';
// Inter — the v2 app font (self-hosted variable font, bundled by Vite; no runtime CDN).
import '@fontsource-variable/inter';
// Space Grotesk — headings/XP/stake numerals (RewardsHub, GamesCarousel, RcIcon already
// reference it in CSS); only weight 700 is used anywhere today, so import just that cut.
import '@fontsource/space-grotesk/700.css';
// Inter Tight — variable file covers the needed 600 + 700 weights.
import '@fontsource-variable/inter-tight';
// Tailwind base + design tokens first, then the existing screen styles layer on top.
// (Foundation only — screens are unchanged in this PR.)
import './index.css';
import './styles.css';

// Explicit registration via the virtual module (replaces the bare auto-injected
// /registerSW.js script — see vite.config.ts's `injectRegister: false`). The
// auto-injected script only registers once and never checks for updates again;
// this path actually implements `registerType: 'autoUpdate'`'s promise: hourly
// polling for a new service worker, and — per autoUpdate's default behavior —
// automatic skip-waiting + reload when one is found, no user prompt needed.
registerSW({
  immediate: true,
  onRegisteredSW(_swUrl, registration) {
    registration && setInterval(() => registration.update(), 60 * 60 * 1000); // hourly
  },
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
