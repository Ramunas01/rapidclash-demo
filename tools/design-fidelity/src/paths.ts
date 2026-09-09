import { existsSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

/** Repo root — three levels up from tools/design-fidelity/src. */
export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');

export const PROTOTYPE_DIR = join(REPO_ROOT, 'design', 'prototype');
export const PROTOTYPE_HTML = join(PROTOTYPE_DIR, 'RapidClash Full Spec.html');
export const PROTOTYPE_URL = pathToFileURL(PROTOTYPE_HTML).href;

/** Where captures and diffs land. references/ is committed; the rest is gitignored. */
export const OUT_DIR = join(REPO_ROOT, 'tools', 'design-fidelity');
export const REFERENCES_DIR = join(OUT_DIR, 'references');
export const CAPTURES_DIR = join(OUT_DIR, 'captures');
export const DIFFS_DIR = join(OUT_DIR, 'diffs');

/**
 * The prototype's dc-runtime (`support.js`) fetches React 18.3.1 UMD from unpkg at boot
 * (`REACT_URL` / `REACT_DOM_URL` in that file). We intercept those requests in Playwright and
 * fulfil them from the workspace copy instead — hermetic, version-locked, no CDN flake.
 */
function findPnpmUmd(pkgGlob: string, file: string): string {
  const pnpmDir = join(REPO_ROOT, 'node_modules', '.pnpm');
  const match = readdirSync(pnpmDir).find((d) => d.startsWith(pkgGlob));
  if (!match) throw new Error(`design-fidelity: could not find ${pkgGlob} under node_modules/.pnpm — run pnpm install`);
  const p = join(pnpmDir, match, 'node_modules', pkgGlob.split('@')[0], 'umd', file);
  if (!existsSync(p)) throw new Error(`design-fidelity: expected UMD build at ${p}`);
  return p;
}

export const REACT_UMD = () => findPnpmUmd('react@18.3.1', 'react.production.min.js');
export const REACT_DOM_UMD = () => findPnpmUmd('react-dom@18.3.1', 'react-dom.production.min.js');

/**
 * Chromium executable. Prefer an explicit env override, else the Playwright browser cache
 * (`PLAYWRIGHT_BROWSERS_PATH` or the default `~/.cache/ms-playwright`). CI runs
 * `pnpm exec playwright install chromium` which populates the default location.
 */
export function chromeExecutable(): string {
  if (process.env.DESIGN_FIDELITY_CHROME && existsSync(process.env.DESIGN_FIDELITY_CHROME)) {
    return process.env.DESIGN_FIDELITY_CHROME;
  }
  const base = process.env.PLAYWRIGHT_BROWSERS_PATH || join(process.env.HOME ?? '', '.cache', 'ms-playwright');
  if (existsSync(base)) {
    const dirs = readdirSync(base)
      .filter((d) => d.startsWith('chromium-') && !d.includes('headless_shell'))
      .sort();
    for (const d of dirs.reverse()) {
      for (const rel of ['chrome-linux64/chrome', 'chrome-linux/chrome', 'chrome-mac/Chromium.app/Contents/MacOS/Chromium']) {
        const p = join(base, d, rel);
        if (existsSync(p)) return p;
      }
    }
  }
  throw new Error(
    'design-fidelity: no Chromium found. Set DESIGN_FIDELITY_CHROME, or run `pnpm exec playwright install chromium`.',
  );
}

/** iPhone-class portrait viewport the migration targets. */
export const VIEWPORT = { width: 390, height: 844 } as const;
export const DEVICE_SCALE_FACTOR = 2;
