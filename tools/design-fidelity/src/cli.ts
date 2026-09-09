import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { CAPTURES_DIR, DIFFS_DIR, REFERENCES_DIR } from './paths.js';
import { appBaseUrl, captureAppScreen, launchApp, openApp } from './app.js';
import { diffPng } from './diff.js';
import { captureScreen, launch, openPrototype, resetPrototype } from './prototype.js';
import { SCREENS, screenById, type Theme } from './screens.js';

const THEMES: Theme[] = ['dark', 'light'];

function ref(theme: Theme, id: string): string {
  return join(REFERENCES_DIR, theme, `${id}.png`);
}
function cap(theme: Theme, id: string): string {
  return join(CAPTURES_DIR, theme, `${id}.png`);
}

/** Regenerate the committed prototype reference set (references/{dark,light}/*.png). */
async function capturePrototype(only?: string): Promise<void> {
  const screens = only ? [screenById(only)] : SCREENS;
  const browser = await launch();
  try {
    for (const theme of THEMES) {
      mkdirSync(join(REFERENCES_DIR, theme), { recursive: true });
      const page = await openPrototype(browser, theme);
      for (const screen of screens) {
        try {
          await resetPrototype(page);
          const png = await captureScreen(page, screen);
          writeFileSync(ref(theme, screen.id), png);
          console.log(`  ✓ ${theme.padEnd(5)} ${screen.id}`);
        } catch (e) {
          console.warn(`  ✗ ${theme.padEnd(5)} ${screen.id} — ${(e as Error).message.split('\n')[0]}`);
        }
      }
      await page.close();
    }
  } finally {
    await browser.close();
  }
  console.log('\nprototype references written to tools/design-fidelity/references/');
}

/** Capture the built app (captures/{dark,light}/*.png) — needs the app already served (--url). */
async function captureApp(url: string | undefined, only?: string): Promise<void> {
  const base = appBaseUrl(url);
  const screens = (only ? [screenById(only)] : SCREENS).filter((s) => {
    if (!s.driveApp && !only) console.warn(`  – ${s.id}: no driveApp yet, skipping`);
    return s.driveApp || only;
  });
  const browser = await launchApp();
  try {
    for (const theme of THEMES) {
      mkdirSync(join(CAPTURES_DIR, theme), { recursive: true });
      for (const screen of screens) {
        try {
          const page = await openApp(browser, base, theme);
          const png = await captureAppScreen(page, screen);
          writeFileSync(cap(theme, screen.id), png);
          await page.close();
          console.log(`  ✓ ${theme.padEnd(5)} ${screen.id}`);
        } catch (e) {
          console.warn(`  ✗ ${theme.padEnd(5)} ${screen.id} — ${(e as Error).message.split('\n')[0]}`);
        }
      }
    }
  } finally {
    await browser.close();
  }
  console.log('\napp captures written to tools/design-fidelity/captures/ — run `diff` to score them');
}

/** Diff the app captures against the prototype references. */
function runDiff(only?: string): void {
  const screens = only ? [screenById(only)] : SCREENS;
  mkdirSync(DIFFS_DIR, { recursive: true });
  const rows: { screen: string; theme: string; fidelity: number; note: string }[] = [];

  for (const theme of THEMES) {
    for (const screen of screens) {
      let a: Buffer;
      let b: Buffer;
      try {
        a = readFileSync(ref(theme, screen.id));
      } catch {
        rows.push({ screen: screen.id, theme, fidelity: NaN, note: 'no reference — run capture-prototype' });
        continue;
      }
      try {
        b = readFileSync(cap(theme, screen.id));
      } catch {
        rows.push({ screen: screen.id, theme, fidelity: NaN, note: 'no app capture — run capture-app' });
        continue;
      }
      const d = diffPng(a, b);
      writeFileSync(join(DIFFS_DIR, `${theme}-${screen.id}.png`), d.diffImage);
      rows.push({
        screen: screen.id,
        theme,
        fidelity: d.fidelity,
        note: d.sizeMismatch
          ? `${d.diffPixels} px differ · compared ${d.sizeMismatch.comparedRegion} (ref ${d.sizeMismatch.ref}, app ${d.sizeMismatch.app})`
          : `${d.diffPixels} px differ`,
      });
    }
  }

  console.log('\n  screen                     theme   fidelity   note');
  console.log('  ' + '-'.repeat(72));
  for (const r of rows) {
    const f = Number.isNaN(r.fidelity) ? '   —   ' : `${r.fidelity.toFixed(2)}%`.padStart(7);
    console.log(`  ${r.screen.padEnd(26)} ${r.theme.padEnd(6)} ${f}   ${r.note}`);
  }
  writeFileSync(join(DIFFS_DIR, 'report.json'), JSON.stringify(rows, null, 2));
  console.log(`\n  full report: ${join(DIFFS_DIR, 'report.json')}  ·  diff images: ${DIFFS_DIR}/`);
}

function argValue(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const [cmd, maybeScreen] = process.argv.slice(2);
const only = maybeScreen && !maybeScreen.startsWith('-') ? maybeScreen : undefined;

switch (cmd) {
  case 'capture-prototype':
    await capturePrototype(only);
    break;
  case 'capture-app':
    await captureApp(argValue('--url'), only);
    break;
  case 'diff':
  case 'report':
    runDiff(only);
    break;
  default:
    console.log('usage: tsx src/cli.ts <capture-prototype | capture-app --url <url> | diff> [screenId]');
    process.exit(1);
}
