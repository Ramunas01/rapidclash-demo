import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { CAPTURES_DIR, DIFFS_DIR, REFERENCES_DIR } from './paths.js';
import { diffPng } from './diff.js';
import { captureScreen, launch, openPrototype, resetPrototype, type Theme } from './prototype.js';
import { SCREENS, screenById } from './screens.js';

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

/** Diff a set of app captures (captures/{dark,light}/*.png) against the references. */
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
        rows.push({ screen: screen.id, theme, fidelity: NaN, note: 'no app capture' });
        continue;
      }
      const d = diffPng(a, b);
      if (d.diffImage) writeFileSync(join(DIFFS_DIR, `${theme}-${screen.id}.png`), d.diffImage);
      rows.push({
        screen: screen.id,
        theme,
        fidelity: d.fidelity,
        note: d.sizeMismatch ? `size mismatch ref=${d.sizeMismatch.a} app=${d.sizeMismatch.b}` : `${d.diffPixels} px differ`,
      });
    }
  }

  console.log('\n  screen                     theme   fidelity   note');
  console.log('  ' + '-'.repeat(70));
  for (const r of rows) {
    const f = Number.isNaN(r.fidelity) ? '   —   ' : `${r.fidelity.toFixed(2)}%`.padStart(7);
    console.log(`  ${r.screen.padEnd(26)} ${r.theme.padEnd(6)} ${f}   ${r.note}`);
  }
  writeFileSync(join(DIFFS_DIR, 'report.json'), JSON.stringify(rows, null, 2));
}

const [cmd, arg] = process.argv.slice(2);
const only = arg && !arg.startsWith('-') ? arg : undefined;

switch (cmd) {
  case 'capture-prototype':
    await capturePrototype(only);
    break;
  case 'diff':
    runDiff(only);
    break;
  case 'report':
    runDiff(only);
    break;
  default:
    console.log('usage: tsx src/cli.ts <capture-prototype|diff> [screenId]');
    process.exit(1);
}
