import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { CAPTURES_DIR, DIFFS_DIR, REFERENCES_DIR } from './paths.js';
import { appBaseUrl, captureAppScreen, launchApp, openApp } from './app.js';
import { diffPng, FIDELITY_GATE } from './diff.js';
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
  type Row = { screen: string; theme: string; fidelity: number | null; pass: boolean | null; note: string };
  const rows: Row[] = [];

  for (const theme of THEMES) {
    for (const screen of screens) {
      let a: Buffer;
      let b: Buffer;
      try {
        a = readFileSync(ref(theme, screen.id));
      } catch {
        rows.push({ screen: screen.id, theme, fidelity: null, pass: null, note: 'no reference — run capture-prototype' });
        continue;
      }
      try {
        b = readFileSync(cap(theme, screen.id));
      } catch {
        rows.push({ screen: screen.id, theme, fidelity: null, pass: null, note: 'no app capture — run capture-app' });
        continue;
      }
      const d = diffPng(a, b, screen.masks);
      writeFileSync(join(DIFFS_DIR, `${theme}-${screen.id}.png`), d.diffImage);
      const parts = [`${d.diffPixels} px differ`];
      if (d.maskedPixels) parts.push(`${screen.masks?.length ?? 0} region(s) masked`);
      if (d.sizeMismatch) parts.push(`compared ${d.sizeMismatch.comparedRegion} (ref ${d.sizeMismatch.ref}, app ${d.sizeMismatch.app})`);
      rows.push({ screen: screen.id, theme, fidelity: d.fidelity, pass: d.pass, note: parts.join(' · ') });
    }
  }

  console.log(`\n  gate: ≥ ${FIDELITY_GATE}% (≤0.5% differing pixels) — plus a human look at any diff image with drift\n`);
  console.log('  screen                     theme   fidelity  gate   note');
  console.log('  ' + '-'.repeat(80));
  for (const r of rows) {
    const f = r.fidelity == null ? '   —   ' : `${r.fidelity.toFixed(2)}%`.padStart(8);
    const g = r.pass == null ? '  ·  ' : r.pass ? ' PASS' : ' FAIL';
    console.log(`  ${r.screen.padEnd(26)} ${r.theme.padEnd(6)} ${f}  ${g}   ${r.note}`);
  }
  writeFileSync(join(DIFFS_DIR, 'report.json'), JSON.stringify(rows, null, 2));
  const failed = rows.filter((r) => r.pass === false).length;
  console.log(`\n  full report: ${join(DIFFS_DIR, 'report.json')}  ·  diff images: ${DIFFS_DIR}/`);
  if (failed) console.log(`  ${failed} screen/theme below gate — open the diff image before deciding.`);
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
