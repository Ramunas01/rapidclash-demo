import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
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
/** `capturesNav` screens get a second `<id>.nav.png` for the bottom-nav strip, diffed separately. */
function navName(id: string): string {
  return `${id}.nav`;
}
/** `scrollFrames` screens get `<id>.frame0.png`, `.frame1.png`, … — one per viewport-tall slice. */
function frameName(id: string, i: number): string {
  return `${id}.frame${i}`;
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
          const shot = await captureScreen(page, screen);
          writeFileSync(ref(theme, screen.id), shot.body);
          if (shot.nav) writeFileSync(ref(theme, navName(screen.id)), shot.nav);
          shot.frames?.forEach((f, i) => writeFileSync(ref(theme, frameName(screen.id, i)), f));
          const suffix = [shot.nav && '+nav', shot.frames && `+${shot.frames.length} frames`].filter(Boolean).join(' ');
          console.log(`  ✓ ${theme.padEnd(5)} ${screen.id}${suffix ? ` (${suffix})` : ''}`);
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
          const shot = await captureAppScreen(page, screen);
          writeFileSync(cap(theme, screen.id), shot.body);
          if (shot.nav) writeFileSync(cap(theme, navName(screen.id)), shot.nav);
          shot.frames?.forEach((f, i) => writeFileSync(cap(theme, frameName(screen.id, i)), f));
          await page.close();
          const suffix = [shot.nav && '+nav', shot.frames && `+${shot.frames.length} frames`].filter(Boolean).join(' ');
          console.log(`  ✓ ${theme.padEnd(5)} ${screen.id}${suffix ? ` (${suffix})` : ''}`);
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

  const one = (theme: Theme, id: string, masks: typeof SCREENS[number]['masks']): void => {
    let a: Buffer;
    let b: Buffer;
    try {
      a = readFileSync(ref(theme, id));
    } catch {
      rows.push({ screen: id, theme, fidelity: null, pass: null, note: 'no reference — run capture-prototype' });
      return;
    }
    try {
      b = readFileSync(cap(theme, id));
    } catch {
      rows.push({ screen: id, theme, fidelity: null, pass: null, note: 'no app capture — run capture-app' });
      return;
    }
    const d = diffPng(a, b, masks);
    writeFileSync(join(DIFFS_DIR, `${theme}-${id}.png`), d.diffImage);
    const parts = [`${d.diffPixels} px differ`];
    if (d.maskedPixels) parts.push(`${masks?.length ?? 0} region(s) masked`);
    if (d.sizeMismatch) parts.push(`compared ${d.sizeMismatch.comparedRegion} (ref ${d.sizeMismatch.ref}, app ${d.sizeMismatch.app})`);
    rows.push({ screen: id, theme, fidelity: d.fidelity, pass: d.pass, note: parts.join(' · ') });
  };

  for (const theme of THEMES) {
    for (const screen of screens) {
      one(theme, screen.id, screen.masks);
      if (screen.capturesNav) one(theme, navName(screen.id), undefined);
      if (screen.scrollFrames) {
        // Frame count isn't known statically — walk forward while either side has that index,
        // so a screen whose content grows/shrinks doesn't need a hardcoded count anywhere.
        for (let i = 0; existsSync(ref(theme, frameName(screen.id, i))) || existsSync(cap(theme, frameName(screen.id, i))); i++) {
          one(theme, frameName(screen.id, i), undefined);
        }
      }
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
