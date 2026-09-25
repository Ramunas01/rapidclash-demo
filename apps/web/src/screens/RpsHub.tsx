import { useEffect, useRef, useState, type ReactNode } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import type { RpsView } from '../App.js';
import { useTheme } from '../lib/theme.js';
import { GameHub, type GameHubScreenProps, type GameAreaArgs } from './GameHub.js';

const RPS_CHOICES = [
  { id: 'rock', label: 'Rock' },
  { id: 'paper', label: 'Paper' },
  { id: 'scissors', label: 'Scissors' },
] as const;

/** T5's prototype-exact font override for "VS" text (`GameHub.tsx`'s own `ARIAL` const, mirrored
 *  here rather than imported — RPS's picker/reveal is a separate concern from T5's shared VS-label
 *  beat and this file must not reach into `GameHub.tsx` for it). Full Spec.html:617/3811-area VS
 *  labels use the same explicit Arial override as every other prototype-exact "VS" text. */
const ARIAL = 'Arial, Helvetica, sans-serif';

/** Cosmetic pick countdown length (seconds), display-only — mirrors `PICK_WINDOW_MS` (10_000) from
 *  `packages/games/rps/src/rps.ts` (NOT imported; the web app stays decoupled from the game
 *  packages, same as `CoinflipHub.tsx`'s `PICK_SECONDS`). The SERVER runs the authoritative clock;
 *  this only drives the digit-flip display. #164/#387: the round resolves ONLY at window expiry —
 *  this file never touches that model, it just paints the countdown toward it. */
const PICK_SECONDS = 10;

// ---- Prototype-exact geometry (Full Spec.html's `isRps` block, lines 605-658) ----------------
/** rpsCardW, non-expanded (Full Spec.html:3805). */
const CARD_W = 92;
/** rpsCardH, non-expanded (Full Spec.html:3806). */
const CARD_H = 130;
/** rpsGap, non-expanded (Full Spec.html:3804). */
const CARD_GAP = 36;
/** rpsVsW, non-expanded (Full Spec.html:3807). */
const VS_WIDTH = 56;

// ---- Ticket 2026-09-12#1 item 2 — `rpsExpanded()`'s "big" geometry (Full Spec.html:3263-3265,
// true during phases 'reveal'/'flip'/'done'; `RpsBoard` below keys this off its own `terminal`
// instead — match-end only, deliberately NOT the tied-round reveal beat, since that state's own
// architecture here is a separate, non-terminal "flash the real throw then reset" beat rather than
// the prototype's single shared phase machine; see `RpsBoard`'s doc comment for why the two can't
// be conflated). Every value below is the `rpsBig` branch of its corresponding constant above
// (Full Spec.html:3804-3807), applied only at `terminal`. -------------------------------------
/** rpsCardW, expanded (Full Spec.html:3805). */
const CARD_W_BIG = 124;
/** rpsCardH, expanded (Full Spec.html:3806). */
const CARD_H_BIG = 176;
/** rpsGap, expanded (Full Spec.html:3804). */
const CARD_GAP_BIG = 12;
/** rpsVsW, expanded (Full Spec.html:3807). */
const VS_WIDTH_BIG = 38;
/** The shared width/height/gap transition every one of the geometry properties above uses in the
 *  prototype (`Full Spec.html:608/609/616`'s identical `transition:...620ms cubic-bezier(0.3,0.9,
 *  0.32,1)` clause on each). */
const EXPAND_EASE = 'cubic-bezier(0.3,0.9,0.32,1)';

// ---- Prototype-exact colors --------------------------------------------------------------------
/** rpsLeftFrame / rpsRightFrame (Full Spec.html:3810-3811). Unlike every other RPS color in this
 *  block, these do NOT branch on `light` in the prototype's own source — they're a flat white
 *  photo-frame at rest and flat green/red/orange on a result, identical in both themes on purpose.
 *  Kept as literal hex (not `--rc-*` tokens) for exactly that reason — routing them through
 *  `--rc-green`/`--rc-danger` would make them theme-dependent, which the design source itself never
 *  is here. */
const FRAME_NEUTRAL = '#FFFFFF';
const FRAME_WIN = '#16A34A';
const FRAME_LOSE = 'var(--rc-loss)';
const FRAME_DRAW = '#F79009';

/** The prototype's real flat-vector purple hand illustrations, ported verbatim (path data copied
 *  byte-for-byte, not approximated) from `Full Spec.html:611-613` — the same three `<path>` groups
 *  the prototype reuses across every hand-icon call site: the live pick cards (:611-613, `width:70px`
 *  inside the `rpsCardW`/`rpsCardH` card), the opponent's revealed card back-face (:646-648, the same
 *  paths again behind `rpsFlipRot`), and the picker row buttons (:646-654, `width:54px`) — one set of
 *  paths, several render sizes, exactly like here (`size` is the only thing that varies per caller).
 *  Replaces the ✊/✋/✌️ emoji stand-ins (2026-09-11#8/C, ADVISOR_TO_PM.md). */
// The optional `color` param silhouettes every path/stroke to a flat single tone when passed.
// Ticket 2026-09-25#1 (Designer's own correction of 2026-09-22#4/D41): the icons are ALWAYS
// purple/multi-tone, confirmed directly against the prototype's own hardcoded SVG fills — no call
// site passes `color` anymore. Left as inert optional plumbing rather than removed, since the
// correction was scoped to the one call site, not this component's signature.
function RpsHandIcon({ choice, size, color }: { choice: string | undefined; size: number; color?: string }) {
  // D41's own cited transition for the color swap (`220ms ease`) — shared across every path so the
  // fill/stroke change animates rather than snapping, matching the citation exactly.
  const fillT = { transition: 'fill 220ms ease' };
  const strokeT = { transition: 'stroke 220ms ease' };
  switch (choice) {
    case 'rock':
      return (
        <svg viewBox="0 0 100 100" width={size} style={{ display: 'block' }} role="img" aria-label="Rock" data-rc-rps-icon="rock">
          <path d="M24 44 A8 8 0 0 1 39.5 41 A8.5 8.5 0 0 1 56 40 A8 8 0 0 1 70 43 A7 7 0 0 1 78 51 L78 70 C78 83 69 92 57 92 L43 92 C31 92 24 84 24 71 Z" fill={color ?? '#B285F7'} style={fillT} />
          <g stroke={color ?? '#7B3BE0'} strokeWidth={2.4} strokeLinecap="round" fill="none" opacity={0.85} style={strokeT}>
            <path d="M39.5 42 v11" />
            <path d="M56 41 v11" />
            <path d="M70 44 v10" />
          </g>
          <path d="M24 56 C29 54.6 35 55 40.4 57 C46.6 59.4 50 64.6 48.4 69.4 C46.6 74.8 39.6 77 33 75 C29 73.8 26 71.6 24 69 Z" fill={color ?? '#8B45F0'} style={fillT} />
          <path d="M24 74 C30 78.6 38 81 46 81 C56 81 67 78.4 76 73.6 C75.4 84 66.6 92 57 92 L43 92 C32.6 92 24.6 84.6 24 74 Z" fill={color ?? '#8B45F0'} opacity={color ? undefined : 0.42} style={fillT} />
        </svg>
      );
    case 'paper':
      return (
        <svg viewBox="0 0 100 100" width={size} style={{ display: 'block' }} role="img" aria-label="Paper" data-rc-rps-icon="paper">
          <path d="M26 60 L25 26 A6.5 6.5 0 0 1 38 26 L39 56 C40 51 41 48 42 45 L42 15 A6.5 6.5 0 0 1 55 15 L55 46 C56 47 57 48 58 49 L58 20 A6.2 6.2 0 0 1 70.4 20 L69 52 C70.5 53 71.5 54 72.5 55 L75 33 A6 6 0 0 1 87 35 L82 62 C83 74 78 87 66 92 L40 92 C30 92 23 86 22 78 C18 74 10 66 8 58 C5 52 12 45 18 50 C22 54 24 57 26 62 Z" fill={color ?? '#B285F7'} style={fillT} />
          <path d="M22 78 C21 68 22 60 26 55 C34 52 48 51 60 53 C70 55 78 58 82 62 C83 74 78 87 66 92 L40 92 C30 92 23 86 22 78 Z" fill={color ?? '#8B45F0'} style={fillT} />
          <path d="M22 78 C18 74 10 66 8 58 C5 52 12 45 18 50 C22 54 24 57 26 62 C25 67 24 73 22 78 Z" fill={color ?? '#7B3BE0'} style={fillT} />
        </svg>
      );
    case 'scissors':
      return (
        <svg viewBox="0 0 100 100" width={size} style={{ display: 'block' }} role="img" aria-label="Scissors" data-rc-rps-icon="scissors">
          <path d="M28 58 L17 28 A6.5 6.5 0 0 1 29.6 23.5 L41 53 C43 49.6 45.6 47.6 48.5 46.8 L54 18 A6.5 6.5 0 0 1 66.6 20.4 L65 52 C71 55.4 74.5 61.4 74.5 69.5 C74.5 82 65.5 91 54 91 L43 91 C31.5 91 25 82.6 25 70.6 C25 65 25.8 60.6 28 58 Z" fill={color ?? '#B285F7'} style={fillT} />
          <path d="M25 70.6 C25 62.6 29.6 56.4 37.6 53.8 C47 51.2 58 53 65.6 57.8 C71 61.2 74.5 64.6 74.5 69.5 C74.5 82 65.5 91 54 91 L43 91 C31.5 91 25 82.6 25 70.6 Z" fill={color ?? '#8B45F0'} style={fillT} />
          <path d="M62 51.5 C70 51.5 74.6 58.4 71.6 64.6 C68.8 70.4 59.6 71 55.6 66.4 C51.6 61.8 53.6 54.4 59.4 52.2 C60.3 51.8 61.2 51.5 62 51.5 Z" fill={color ?? '#6428BE'} style={fillT} />
          <path d="M65 66 C71.6 66.6 74.6 73.6 70.6 78.6 C66.6 83.6 58.4 82.6 55.4 77.6 C52.6 73 55.4 67 61 66.2 C62.3 66 63.6 65.9 65 66 Z" fill={color ?? '#6428BE'} opacity={color ? undefined : 0.72} style={fillT} />
          <path d="M26 65 C31.6 63 38 63 43.6 65 C49.6 67.2 52.4 72.6 50 77.2 C47.4 82 39.6 83 33.6 79.8 C29.6 77.6 26.6 74.4 25.4 71 Z" fill={color ?? '#7B3BE0'} style={fillT} />
        </svg>
      );
    default:
      return null;
  }
}

/** Opponent's redacted/hidden state: a solid `#4F4CEA` fill (`Full Spec.html:628`, exact citation)
 *  behind a single flat-fill bolt icon (`:629`, `fill="#4340D8"`, rendered at `width:74%` of the
 *  tile) — replaces the 🤫 emoji stand-in (2026-09-11#8/C). Path data ported verbatim, not
 *  approximated. Always paired with `background: '#4F4CEA'` overriding the neutral `tileBg` at its
 *  call sites (`RpsIdle`'s opponent card, `RpsBoard`'s non-revealed opponent card, and
 *  `RpsRevealFlipCard`'s front/hidden face) — every OTHER tile in this file keeps using the
 *  theme-conditional `tileBg`; this is the one deliberate exception, matching the prototype's own
 *  source exactly (the opponent card's front face is the only tile in `isRps` that doesn't use
 *  `rpsTileBg`). */
function RpsRedactedIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 351 374" width="74%" style={{ display: 'block' }} role="img" aria-label="Hidden" data-rc-rps-icon="redacted">
      <path fill="#4340D8" d="M189.84 23.99C187.66 24.20 185.18 24.67 182.99 25.40C180.80 26.13 178.56 27.05 176.69 28.37C174.81 29.69 173.35 31.62 171.73 33.30C170.12 34.98 168.61 36.77 167.01 38.47C165.41 40.17 163.74 41.80 162.15 43.50C160.56 45.21 159.03 46.98 157.46 48.69C155.88 50.41 154.28 52.11 152.67 53.80C151.07 55.50 149.41 57.14 147.82 58.85C146.23 60.56 144.72 62.34 143.13 64.05C141.55 65.76 139.91 67.43 138.31 69.12C136.71 70.82 135.10 72.51 133.52 74.22C131.94 75.94 130.42 77.71 128.82 79.41C127.22 81.11 125.54 82.74 123.94 84.43C122.34 86.13 120.78 87.87 119.20 89.58C117.61 91.29 116.02 93.00 114.43 94.70C112.84 96.41 111.23 98.10 109.64 99.81C108.05 101.51 106.49 103.25 104.89 104.94C103.28 106.64 101.61 108.27 100.02 109.97C98.42 111.67 96.90 113.44 95.31 115.15C93.73 116.86 92.09 118.53 90.50 120.23C88.90 121.93 87.30 123.63 85.72 125.35C84.14 127.06 82.59 128.81 80.99 130.51C79.39 132.21 77.72 133.84 76.13 135.54C74.54 137.25 73.01 139.02 71.43 140.73C69.85 142.45 68.25 144.15 66.65 145.84C65.04 147.54 63.39 149.18 61.80 150.89C60.21 152.60 58.70 154.38 57.11 156.09C55.53 157.80 53.89 159.46 52.28 161.16C50.68 162.85 49.08 164.55 47.50 166.26C45.92 167.98 44.40 169.75 42.80 171.45C41.20 173.15 39.52 174.78 37.92 176.47C36.32 178.17 34.76 179.90 33.18 181.62C31.60 183.34 29.80 184.91 28.46 186.79C27.13 188.67 25.86 190.72 25.17 192.89C24.49 195.06 24.43 197.50 24.34 199.82C24.26 202.14 24.30 204.51 24.65 206.81C24.99 209.10 25.53 211.43 26.39 213.57C27.24 215.72 28.41 217.82 29.77 219.68C31.13 221.54 32.75 223.31 34.55 224.75C36.35 226.18 38.43 227.44 40.57 228.28C42.70 229.12 45.08 229.50 47.38 229.77C49.68 230.05 52.04 229.92 54.38 229.95C56.71 229.98 59.04 229.93 61.38 229.95C63.71 229.97 66.04 229.99 68.37 230.05C70.71 230.12 73.04 230.27 75.37 230.36C77.70 230.46 80.03 230.56 82.36 230.60C84.69 230.65 87.03 230.64 89.36 230.66C91.69 230.68 94.03 230.70 96.36 230.71C98.69 230.72 101.03 230.72 103.36 230.72C105.69 230.72 108.03 230.73 110.36 230.73C112.69 230.73 115.03 230.72 117.36 230.73C119.69 230.74 122.03 230.72 124.36 230.77C126.69 230.82 129.03 230.91 131.36 231.02C133.69 231.13 136.01 231.37 138.34 231.45C140.67 231.53 143.01 231.49 145.34 231.52C147.68 231.54 150.46 230.98 152.34 231.59C154.22 232.20 156.30 233.47 156.64 235.17C156.98 236.88 155.16 239.60 154.40 241.81C153.65 244.01 152.91 246.23 152.12 248.42C151.33 250.62 150.44 252.78 149.67 254.98C148.89 257.18 148.23 259.42 147.46 261.62C146.69 263.82 145.84 266.00 145.04 268.19C144.24 270.38 143.43 272.57 142.66 274.77C141.90 276.98 141.22 279.21 140.44 281.41C139.65 283.61 138.76 285.76 137.97 287.96C137.18 290.15 136.47 292.38 135.71 294.58C134.94 296.79 134.19 298.99 133.39 301.19C132.60 303.38 131.74 305.55 130.96 307.75C130.19 309.95 129.43 312.16 128.75 314.39C128.06 316.62 127.21 318.84 126.84 321.12C126.48 323.41 126.35 325.81 126.58 328.10C126.81 330.40 127.31 332.77 128.22 334.87C129.12 336.97 130.47 339.00 132.00 340.70C133.54 342.41 135.43 343.94 137.41 345.11C139.39 346.28 141.66 347.09 143.88 347.74C146.11 348.39 148.46 348.86 150.76 348.99C153.07 349.13 155.45 348.98 157.71 348.54C159.98 348.11 162.35 347.49 164.34 346.39C166.34 345.29 167.99 343.51 169.70 341.93C171.41 340.36 172.98 338.61 174.59 336.93C176.20 335.24 177.77 333.51 179.37 331.81C180.96 330.10 182.53 328.38 184.14 326.69C185.74 325.00 187.40 323.35 189.01 321.66C190.62 319.97 192.20 318.26 193.79 316.55C195.38 314.84 196.94 313.11 198.55 311.42C200.16 309.73 201.83 308.10 203.44 306.41C205.06 304.73 206.63 303.01 208.23 301.31C209.83 299.61 211.42 297.90 213.03 296.21C214.64 294.52 216.27 292.86 217.88 291.16C219.48 289.47 221.06 287.75 222.65 286.05C224.25 284.34 225.81 282.61 227.43 280.93C229.04 279.24 230.72 277.62 232.33 275.93C233.95 274.25 235.51 272.52 237.10 270.80C238.68 269.09 240.25 267.36 241.85 265.67C243.46 263.97 245.11 262.33 246.73 260.64C248.34 258.96 249.95 257.27 251.54 255.56C253.13 253.86 254.66 252.09 256.26 250.39C257.85 248.69 259.51 247.04 261.13 245.36C262.75 243.68 264.38 242.02 265.98 240.31C267.57 238.61 269.09 236.84 270.68 235.13C272.27 233.43 273.91 231.76 275.53 230.08C277.15 228.40 278.79 226.75 280.39 225.05C281.99 223.35 283.53 221.59 285.12 219.88C286.71 218.18 288.32 216.49 289.93 214.81C291.55 213.12 293.20 211.47 294.81 209.78C296.42 208.09 297.99 206.37 299.58 204.66C301.17 202.96 302.75 201.24 304.36 199.55C305.97 197.86 307.61 196.20 309.22 194.51C310.82 192.82 312.42 191.11 314.00 189.40C315.58 187.68 317.28 186.05 318.71 184.22C320.14 182.38 321.48 180.43 322.57 178.39C323.66 176.34 324.69 174.18 325.26 171.95C325.82 169.72 326.01 167.31 325.96 165.00C325.92 162.70 325.73 160.26 324.99 158.10C324.25 155.95 322.96 153.87 321.53 152.07C320.11 150.27 318.32 148.62 316.43 147.30C314.54 145.98 312.38 144.93 310.22 144.13C308.05 143.32 305.72 142.86 303.43 142.44C301.14 142.03 298.81 141.77 296.49 141.62C294.16 141.48 291.82 141.58 289.49 141.57C287.15 141.56 284.82 141.57 282.49 141.57C280.15 141.57 277.82 141.57 275.49 141.57C273.15 141.57 270.82 141.57 268.49 141.57C266.15 141.57 263.82 141.57 261.49 141.57C259.15 141.57 256.82 141.56 254.49 141.55C252.15 141.54 249.82 141.52 247.49 141.51C245.15 141.50 242.82 141.51 240.49 141.51C238.15 141.51 235.82 141.51 233.49 141.51C231.15 141.51 228.82 141.51 226.49 141.51C224.15 141.50 221.82 141.50 219.49 141.50C217.15 141.49 214.82 141.50 212.49 141.49C210.15 141.49 207.82 141.49 205.49 141.47C203.15 141.44 200.80 141.52 198.49 141.33C196.18 141.14 193.04 141.55 191.63 140.34C190.21 139.13 189.98 136.25 190.01 134.08C190.04 131.90 191.14 129.55 191.80 127.31C192.45 125.07 193.22 122.87 193.94 120.65C194.67 118.43 195.43 116.22 196.15 114.00C196.86 111.78 197.50 109.54 198.23 107.32C198.96 105.11 199.77 102.92 200.53 100.71C201.29 98.50 202.06 96.30 202.79 94.09C203.53 91.87 204.19 89.63 204.95 87.43C205.71 85.22 206.58 83.05 207.35 80.85C208.12 78.65 208.82 76.42 209.56 74.21C210.31 72.00 211.06 69.79 211.84 67.59C212.61 65.39 213.50 63.22 214.20 61.00C214.91 58.78 215.58 56.54 216.06 54.26C216.54 51.98 217.01 49.65 217.07 47.34C217.13 45.02 216.97 42.62 216.44 40.39C215.92 38.15 215.13 35.83 213.90 33.91C212.68 31.99 210.93 30.24 209.09 28.88C207.25 27.52 205.03 26.53 202.86 25.73C200.69 24.93 198.24 24.38 196.07 24.09C193.90 23.80 192.02 23.77 189.84 23.99Z" />
    </svg>
  );
}

/** rpsTileBg (Full Spec.html:3819): the sunken tile behind each card's icon / each picker button.
 *  Theme-conditional in the prototype's own source (unlike the frame colors above), so this reads
 *  the resolved theme the same way the prototype's own `light` var does. No existing `--rc-*` token
 *  carries this exact pair (`--rc-sunken` is close but not equal — #0b0b0b/#d3d3dd vs this block's
 *  #12121F/#DEDEE8), so it's threaded locally rather than reused from a token with a different value.
 *
 *  A real hook — every caller in this file (`RpsIdle`, `RpsBoard`) is a mounted component, unlike the
 *  now-removed `RpsReveal`, which GameHub invoked as a plain callback during its OWN render and
 *  needed a non-hook twin to avoid attaching to GameHub's hook list (2026-09-11#10 item 2 deleted
 *  that component along with the now-unneeded plain `rpsTileBg()` variant). */
function useRpsTileBg(): string {
  const { resolved } = useTheme();
  return resolved === 'light' ? '#DEDEE8' : '#12121F';
}

/** One square "photo-frame" card: a colored outer frame (padding:6px, border-radius:14px, the
 *  `0 6px 16px rgba(0,0,0,0.28)` shadow) around a sunken inner tile (border-radius:9px). Matches
 *  Full Spec.html:609-610 (and the reveal's smaller :627/:632-633 pair) — the shared shape both the
 *  in-match cards and the result-reveal cards are built from. */
function RpsFrame({
  frame, tileBg, size, height, children, testid,
}: {
  frame: string;
  tileBg: string;
  size: number;
  height?: number;
  children: ReactNode;
  testid?: string;
}) {
  return (
    <div
      data-testid={testid}
      className="shrink-0 rounded-[14px] p-[6px] shadow-[0_6px_16px_rgba(0,0,0,0.28)]"
      // Ticket 2026-09-12#1 item 2: width/height now animate too (the card grows at `terminal`) —
      // matches Full Spec.html:609's own transition list exactly (background 420ms ease, width/height
      // 620ms cubic-bezier(0.3,0.9,0.32,1)); moved off Tailwind's `transition-*` utilities since they
      // can't express two different durations/easings in one declaration.
      style={{ width: size, height: height ?? size, background: frame, transition: `background 420ms ease, width 620ms ${EXPAND_EASE}, height 620ms ${EXPAND_EASE}` }}
    >
      <div className="relative flex h-full w-full items-center justify-center overflow-hidden rounded-[9px]" style={{ background: tileBg }}>
        {children}
      </div>
    </div>
  );
}

/** Digit-flip countdown — mirrors the prototype's `rcClockOut`/`rcClockIn` keyframe pair
 *  (Full Spec.html:90-93). The outgoing digit slides down 26px, flashing through violet (#B285F7 at
 *  the 45% mark, Full Spec.html:90) before fading out at #8B45F0, 240ms cubic-bezier(0.33,0,0.67,0.35)
 *  (:90-91). The incoming digit slides up from -18px while fading in, 260ms
 *  cubic-bezier(0.3,0.9,0.32,1) (:92-93). The prototype re-triggers this every tick by alternating
 *  between two identical keyframe names (a CSS restart trick); Framer's keyed `AnimatePresence`
 *  gets the same per-tick replay for free. Font: Full Spec.html:620-621 (`'Space Grotesk'`, 26px,
 *  700, `var(--rc-text)`). */
function RpsCountdown({ seconds }: { seconds: number }) {
  return (
    <div
      className="relative h-[26px] w-[52px] overflow-hidden"
      role="timer"
      aria-label={`${seconds} seconds to pick`}
      data-testid="rps-countdown"
    >
      <AnimatePresence initial={false}>
        <motion.span
          key={seconds}
          className="absolute inset-0 flex items-center justify-center font-bold leading-none tabular-nums"
          style={{ fontFamily: "'Space Grotesk', " + ARIAL, fontSize: 26, color: 'var(--rc-text)' }}
          initial={{ y: -18, opacity: 0 }}
          animate={{ y: 0, opacity: 1, transition: { duration: 0.26, ease: [0.3, 0.9, 0.32, 1] } }}
          exit={{
            y: 26,
            opacity: 0,
            color: ['var(--rc-text)', '#B285F7', '#8B45F0'],
            transition: { duration: 0.24, ease: [0.33, 0, 0.67, 0.35], times: [0, 0.45, 1] },
          }}
        >
          {seconds}
        </motion.span>
      </AnimatePresence>
    </div>
  );
}

/** Idle/Waiting preview shown before a match starts. Full Spec.html's `isRps` block (:605-658) is
 *  ONE persistent panel — the two-card + VS frame (:608-641) sits directly above the picker grid
 *  (:643-654) with no `sc-if` between them, so the prototype shows both together at rest, not just
 *  once a match is live: `rpsBoardOp` (:606, wired at `RpsPanel`'s wrapper below — ticket
 *  2026-09-12#1 item 1's table-dim fix) gates the whole panel's visibility (this idle preview
 *  included), not this row specifically, and `rpsChoicesOp`/`rpsChoicesPE` (:643) only ever
 *  dim/disable the picker grid.
 *  #512: this component (unlike `RpsBoard` below, T6b/#509) still only rendered the old plain grid
 *  with no card/VS frame above it — this reuses `RpsFrame`/`ARIAL`/the card constants T6b already
 *  added rather than duplicating that markup.
 *
 *  Idle variant of the frame: both cards render empty/placeholder (no pick exists yet — mirrors
 *  `rpsRock.op`/`rpsPaper.op`/`rpsScissors.op` and the opponent-side equivalents all sitting at 0 in
 *  the prototype's own at-rest state, :611-613/:634-636) and the digit-flip clock is omitted
 *  entirely rather than shown static-and-frozen — the prototype gates that clock's own box with
 *  `rpsClockOp`/`rpsClockScale` (:618) exactly because there's no live pick window to count down
 *  outside a match; `RpsBoard`'s live countdown only ever mounts once `phase === 'in-match'`. */
function RpsIdle() {
  const tileBg = useRpsTileBg();
  return (
    <div className="flex flex-col items-center gap-4 py-3">
      <div className="flex items-center justify-center" style={{ gap: CARD_GAP }}>
        <RpsFrame frame={FRAME_NEUTRAL} tileBg={tileBg} size={CARD_W} height={CARD_H} testid="hub-idle-my-pick">
          <span className="text-3xl opacity-0">•</span>
        </RpsFrame>
        <div className="flex shrink-0 items-center justify-center" style={{ width: VS_WIDTH }}>
          <span
            className="font-bold"
            style={{ fontFamily: ARIAL, fontSize: 16, letterSpacing: 1, color: '#FFFFFF' }}
          >
            VS
          </span>
        </div>
        <RpsFrame frame={FRAME_NEUTRAL} tileBg="#4F4CEA" size={CARD_W} height={CARD_H} testid="hub-idle-opponent-pick">
          <RpsRedactedIcon />
        </RpsFrame>
      </div>

      {/* Ticket 2026-09-22#4 (D41): the prototype's own tile markup (`Full Spec.html:641-656`) is
          genuinely just one `<svg>` — no text label at all. Dropped here and at the live picker
          below; `RPS_CHOICES`'s own `label` field stays (still used for the live picker's
          `aria-label`, unrelated to this citation). `gap-1` (icon-to-label spacing) is dead weight
          with only one child now — dropped too. Also added `px-1.5` (6px horizontal padding) to
          match the citation's own `padding:16px 6px` in full — previously only the vertical half
          (`py-4`) was implemented. */}
      <div className="grid w-full grid-cols-3 opacity-50" style={{ gap: 9 }}>
        {RPS_CHOICES.map((c) => (
          <div key={c.id} className="flex items-center justify-center rounded-[16px] px-1.5 py-4" style={{ background: tileBg }}>
            <RpsHandIcon choice={c.id} size={54} />
          </div>
        ))}
      </div>
      {/* 2026-09-11#8/C: the prototype's own `isRps` block (:605-658) has no text in this vertical
          space at rest — it's empty/compact, not a caption. The "Choose a bet and press PLAY…"
          instructional sentence was never in the prototype source; removed.
          Ticket 2026-09-12#1 item 4 (ADVISOR_TO_PM.md): the "Waiting for an opponent…" paragraph
          that used to render here (gated on `phase === 'waiting'`) was ALSO removed — grepped the
          entire prototype and it has exactly ONE "waiting" text for this state, the opponent bar's
          own "Searching…" span (`Full Spec.html:462`, `GameHub.tsx`'s `OpponentSlot`, already
          correct/untouched). This paragraph was a genuine third copy alongside that AND `GameHub.tsx`'s
          own shared PLAY-button countdown label ("Waiting for an opponent · m:ss") — the prototype
          never has this third copy, so it's a real duplicate, not a decorative stand-in like the
          instructional sentence above. Do not re-add it; the shared PLAY-button label is the one
          "waiting" text every hub (not just RPS) already shows correctly. */}
    </div>
  );
}

/**
 * The live in-match board (lifts Play.tsx's choice UI), now ALSO the terminal result presentation
 * (2026-09-11#10 item 2, ADVISOR_TO_PM.md) — this component stays mounted through 'in-match' AND
 * 'result' (see `RpsPanel` above), so the same DOM node carries the match from opening pick through
 * final reveal, matching the prototype exactly: there is no separate full-screen result modal for
 * this game anywhere in `Full Spec.html` — the persistent `isRps` block (:605-658) IS the result
 * screen too, just with `rpsLeftFrame`/`rpsRightFrame`/`rpsFlipRot` swapping from their at-rest
 * values to their outcome-colored ones (:3808-3810) in place.
 *
 * Redaction: your pick always shows; the opponent stays hidden (solid #4F4CEA + bolt icon,
 * 2026-09-11#8/C) EXCEPT for two deliberate reveal beats, both reusing the SAME
 * `RpsRevealFlipCard` (Full Spec.html:625-637's 3D flip) AND, since ticket 2026-09-25#2/#3, the SAME
 * shared `revealStage` staged timing (grow → 700ms pause → flip → +900ms → done) — see "Composing
 * the two reveals" below:
 *   1. A brief beat right after a TIED round (2026-09-11#9 item 2; staged timing since 2026-09-25#3)
 *      — non-terminal, auto-resets ~1.5s after `done`, back to the redacted tile for the next round.
 *   2. The match's TERMINAL reveal (2026-09-11#10 item 2) — win/lose/void, gated on `outcome` (set
 *      only once the match actually ends, `GameHub.tsx`'s `areaArgs.outcome`), and persists (no
 *      reset) since there's no next round to reset into.
 *
 * Visual rebuild (T6b): two square "photo-frame" cards either side of a VS + digit-flip countdown
 * (Full Spec.html:605-658) — your card shows your live pick (an opacity/scale swap between the
 * three icons, Full Spec.html:611-613's `op`/`scale` treatment; frozen to the tie's own snapshot
 * during an active tie-reveal — see `myCardChoice`). Once a reveal's own `done` stage lands, both
 * frames pick up the outcome color (`myFrame`/`oppFrame` below, ported byte-for-byte from the now-
 * removed `RpsReveal` overlay component's identical formula — Full Spec.html:3808-3810's
 * `rpsLeftFrame`/`rpsRightFrame`): mine turns green/red/orange on win/lose/void, the opponent's only
 * ever turns orange on void or an ordinary tie, otherwise stays the neutral white frame both cards
 * use pre-reveal. Card SIZE growth (`cardW`/`cardH` big geometry) stays terminal-only, unchanged
 * from ticket 2026-09-12#1 item 2 — an ordinary tie's reveal plays at the small geometry.
 *
 * Composing the two reveals (a terminal outcome can never actually race a pending tie-reveal — the
 * tie-reveal's own full window is `REVEAL_PAUSE_MS + REVEAL_FLIP_TO_DONE_MS + TIE_REVEAL_HOLD_MS` ≈
 * 3.1s, while the very next round's EARLIEST possible resolution is a full fresh `PICK_WINDOW_MS` ≈
 * 10s later, since a round only ever resolves at window expiry — `rps.ts`'s `resolve()`/
 * `isLockTime()` — never early on "both chosen"; but this renders defensively rather than leaning on
 * that timing margin alone, e.g. for a future shortened test window): the terminal reveal ALWAYS
 * wins over `tieReveal` state (see the effect that clears any pending tie-reveal the instant
 * `terminal` goes true, and `revealKey`'s own `terminal ? … : tieReveal ? … : null` priority order)
 * — the two can never mount competing flips into the same opponent-card slot, and share one
 * `revealStage` machine rather than two independent timers.
 *
 * `suppressResultOverlay` is wired on the `<GameHub>` call below. Ticket 2026-09-25#3 item 2 adds
 * `ownBarResult`+`gateResultOnReveal` (a DELIBERATE divergence from the prototype — see that call's
 * comment for the citation chain that both introduces and justifies it); no `holdResultMs` — RPS's
 * reveal is gated on its own `revealStage` reaching 'done' via `onRevealComplete`, the same
 * mechanism `holdResultMs` would otherwise exist to approximate, so adding both would be redundant.
 *
 * Timer-only-resolve model (#164): the pick is CLIENT-LOCAL and FREELY CHANGEABLE for the whole
 * window — tapping a throw rings it PURPLE immediately (no wait for the server echo) and re-tapping
 * moves the selection. Buttons are NEVER gated by `legalMoves`/`your_turn` (all three stay legal all
 * window; the client ignores that churn). Every tap sends the replacement throw; the server locks
 * both at window expiry. No same-side/"taken-throw" restriction (it would leak the opponent's pick).
 * Once terminal, the grid locks (see `terminal` below) — there is no round left to pick into.
 */
function RpsBoard({ playerId, opponentId, gameState, events, onMove, outcome, onRevealComplete, serverClockOffset = 0 }: GameAreaArgs) {
  const view = gameState as RpsView | null;
  const tileBg = useRpsTileBg();
  // Terminal outcome (win/draw/void) — set by GameHub only once the match has actually ended
  // (`areaArgs.outcome`, null for the whole live match). Ported from the now-removed `RpsReveal`
  // overlay component's identical formula (Full Spec.html:3808-3810's `rpsLeftFrame`/`rpsRightFrame`).
  // RPS never actually produces a terminal `draw` (ties auto-replay server-side, `rps.ts`'s
  // `resolve()`) — only a decisive `win` or, at the replay cap, `void`; `void` gets the same neutral
  // "neither side" treatment `draw` would. Ticket 2026-09-25#3 (D49): at the replay cap this becomes
  // a genuine TERMINAL void (`rps.ts`'s `resolve()` sets `forcedOutcome`) — it already flows through
  // this exact `terminal`/`outcome` path, never through the ordinary tie-reveal mechanism below, so
  // it automatically gets the same orange `done` coloring AND the terminal path's own "stays
  // expanded, no auto-continue" behavior with zero special-casing — there is no live match left to
  // auto-continue into, and this path never has one.
  const terminal = outcome != null;
  const mineWon = outcome?.type === 'win' && outcome.winner === playerId;
  const oppWon = outcome?.type === 'win' && outcome.winner !== playerId;
  const neutralOutcome = outcome?.type === 'draw' || outcome?.type === 'void';

  // 2026-09-11#9 item 2 (deliberate, Owner-approved redaction rollback — see rps.ts's resolve()):
  // a tied round's `new_round` event carries `revealedChoices`, both players' real throws for the
  // round that just ended. Flip the opponent's card from the redacted blue-bolt face to that real
  // throw, hold it, then fall back to the redacted tile as the fresh round's window opens.
  // Ticket 2026-09-25#3 item 2 (ADVISOR_TO_PM.md): also snapshots the caller's OWN throw
  // (`revealed[playerId]`, same payload, previously unread) — `optimisticPick`/`serverChoice` both
  // go blank immediately once the round bumps and the fresh round's `choices` clears server-side,
  // so without this the OWN card's hand would vanish mid-reveal while only the opponent's stayed
  // visible. See `myCardChoice` below for how this snapshot is scoped to the own CARD display only,
  // not the picker tiles (which must stay live so a fresh tap for the new round still registers).
  const [tieReveal, setTieReveal] = useState<{ seq: number; myChoice: string | undefined; oppChoice: string | undefined } | null>(null);
  const tieRevealSeq = useRef(0);
  const tieRevealTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (tieRevealTimer.current) clearTimeout(tieRevealTimer.current); }, []);
  useEffect(() => {
    if (terminal) return; // match already over — no more rounds, nothing to tie-reveal.
    const newRound = events?.find((e) => e.type === 'new_round');
    const revealed = (newRound?.payload as { revealedChoices?: Record<string, string> } | undefined)?.revealedChoices;
    const oppChoice = opponentId ? revealed?.[opponentId] : undefined;
    if (!oppChoice) return; // not a tie's new_round (or no opponent id yet) — nothing to reveal.
    tieRevealSeq.current += 1;
    setTieReveal({ seq: tieRevealSeq.current, myChoice: playerId ? revealed?.[playerId] : undefined, oppChoice });
    if (tieRevealTimer.current) clearTimeout(tieRevealTimer.current);
    tieRevealTimer.current = setTimeout(() => setTieReveal(null), REVEAL_PAUSE_MS + REVEAL_FLIP_TO_DONE_MS + TIE_REVEAL_HOLD_MS);
  }, [events, opponentId, playerId, terminal]);
  // 2026-09-11#10 item 2: a terminal outcome always wins over any still-pending tie-reveal — see
  // "Composing the two reveals" in the doc comment above for why this can't actually race in
  // practice, and why this clears defensively anyway rather than relying on timing margin alone.
  useEffect(() => {
    if (!terminal) return;
    if (tieRevealTimer.current) { clearTimeout(tieRevealTimer.current); tieRevealTimer.current = null; }
    setTieReveal(null);
  }, [terminal]);

  // Ticket 2026-09-25#2/#3 item 1 (ADVISOR_TO_PM.md): the reveal's own three staggered beats —
  // confirmed precisely against the prototype's own `rpsTimer` chain (Full Spec.html:3083-3102) —
  // now drive BOTH the terminal reveal AND an ordinary tie's reveal identically. D49 definitively
  // answers D48's own open question: yes, the same staged sequence applies to both, at the same
  // timestamps. `revealKey` is whichever reveal is currently active (`'terminal'`, or the tie's own
  // seq) — a fresh key restarts the 700ms pause → 'flip' (the opponent card mounts, 820ms rotateY +
  // translateX nudge) → +900ms more → 'done' (frame colors land, ~80ms after the 820ms flip
  // finishes). `null` (no active reveal) holds at 'grow'.
  // Card SIZE (`cardW`/`cardH` below) stays a SEPARATE, terminal-only concern, unchanged from
  // ticket 2026-09-12#1 item 2's still-valid decision — D49's "identical beats" is read here as the
  // STATE-MACHINE TIMING all three outcomes now share, not a reopening of that geometry decision
  // (D49's own text frames itself as answering D48's specifically pause-timing-scoped open question,
  // not the separate, explicitly-preserved card-growth one) — flagged explicitly to Advisor/Owner as
  // an interpretation worth a sanity check rather than assumed silently.
  const REVEAL_PAUSE_MS = 700;
  const REVEAL_FLIP_TO_DONE_MS = 900;
  const TIE_REVEAL_HOLD_MS = 1500;
  const revealKey = terminal ? 'terminal' : tieReveal ? `tie-${tieReveal.seq}` : null;
  const [revealStage, setRevealStage] = useState<'grow' | 'flip' | 'done'>('grow');
  useEffect(() => {
    if (revealKey == null) { setRevealStage('grow'); return; }
    setRevealStage('grow');
    const t = setTimeout(() => setRevealStage('flip'), REVEAL_PAUSE_MS);
    return () => clearTimeout(t);
  }, [revealKey]);
  useEffect(() => {
    if (revealStage !== 'flip') return;
    const t = setTimeout(() => setRevealStage('done'), REVEAL_FLIP_TO_DONE_MS);
    return () => clearTimeout(t);
  }, [revealStage]);
  const revealActive = terminal || tieReveal != null;
  const revealDone = revealActive && revealStage === 'done';
  // Ticket 2026-09-25#3 item 2 (ADVISOR_TO_PM.md): fires the shared bar-lighting signal the instant
  // the TERMINAL reveal (not an ordinary tie's own 'done') finishes. `onRevealComplete` sets a
  // once-per-MATCH flag on the GameHub side (`revealDone`) — in this build, GameHub's own
  // `currentMatchId`-keyed reset of that flag happens to ALSO protect against a tie's own 'done'
  // corrupting a later terminal reveal in the same match (confirmed empirically: match-end always
  // changes `currentMatchId`, resetting the flag in the same render). Guarded to terminal-only here
  // anyway, defensively — `RpsBoard`'s own contract shouldn't depend on a caller-side reset it
  // doesn't control, matching this file's established philosophy elsewhere (e.g. the tie-vs-terminal
  // render-priority effect below, "renders defensively rather than leaning on timing margin alone").
  useEffect(() => {
    if (terminal && revealDone) onRevealComplete?.();
  }, [terminal, revealDone, onRevealComplete]);
  const myFrame = mineWon ? FRAME_WIN : oppWon ? FRAME_LOSE : neutralOutcome ? FRAME_DRAW : tieReveal ? FRAME_DRAW : FRAME_NEUTRAL;
  const oppFrame = neutralOutcome ? FRAME_DRAW : tieReveal ? FRAME_DRAW : FRAME_NEUTRAL;
  // Ticket 2026-09-12#1 item 2 (ADVISOR_TO_PM.md): `rpsExpanded()`'s big geometry, keyed off
  // `terminal` — deliberately match-end ONLY, not the tied-round reveal beat below. In the
  // prototype's own single phase machine `rpsExpanded()` (reveal/flip/done) actually also covers a
  // tie's 'flip' moment, so its cards grow there too — but this codebase's tie-reveal is a
  // structurally separate, non-terminal "flash the real throw, hold, reset" beat (2026-09-11#9 item
  // 2) built on its own local `tieReveal` state, not the prototype's shared phase field, so there is
  // no faithful way to key growth off "the tie's flip sub-moment" here without inventing a second,
  // unrelated timing window. Keeping growth strictly terminal-only is simpler, cannot desync from the
  // match's real end, and never fights the tie-reveal's own 1.5s hold/reset timer for the frame size.
  const cardW = terminal ? CARD_W_BIG : CARD_W;
  const cardH = terminal ? CARD_H_BIG : CARD_H;
  const cardGap = terminal ? CARD_GAP_BIG : CARD_GAP;
  const vsWidth = terminal ? VS_WIDTH_BIG : VS_WIDTH;
  // The opponent's real throw — `viewFor` (rps.ts) stops redacting once the state is terminal, so
  // this is already the true value by the time `outcome` (and therefore `terminal`) arrives.
  const oppThrow = opponentId ? view?.choices?.[opponentId] : undefined;
  // Own throw is not redacted, but it trails the tap by a round-trip — the optimistic pick bridges it.
  const serverChoice = playerId ? view?.choices?.[playerId] : undefined;
  const [optimisticPick, setOptimisticPick] = useState<string | null>(null);
  // Clear the local pick when the round closes (round bumps on replay; choices clears) so the next
  // window opens blank.
  const round = view?.round;
  useEffect(() => {
    setOptimisticPick(null);
  }, [round]);
  const myChoice = optimisticPick ?? serverChoice;
  // Ticket 2026-09-25#3 item 2: the OWN CARD's displayed choice, separate from `myChoice` above.
  // `myChoice` stays LIVE (drives the picker tiles + `handlePick`, so a fresh tap for the NEW round
  // always visibly registers even while the PREVIOUS round's tie-reveal is still holding) —
  // `myCardChoice` freezes to the tie's own snapshot for the own card's icon specifically, so that
  // icon doesn't vanish while a tie-reveal plays, without freezing tile-selection interactivity.
  const myCardChoice = tieReveal ? tieReveal.myChoice : myChoice;
  function handlePick(id: string) {
    setOptimisticPick(id);
    onMove(id);
  }

  // Cosmetic countdown, driven by the server's authoritative window close (`windowEndsAt`) when
  // present — accurate and RESTARTS automatically on each tie-replay round (re-stamped server-side).
  // Falls back to a static PICK_SECONDS if the field is absent. Mirrors CoinflipHub.tsx's identical
  // countdown effect one-for-one (same 10s model, same field).
  const windowEndsAt = view?.windowEndsAt;
  const [seconds, setSeconds] = useState(PICK_SECONDS);
  useEffect(() => {
    const tick = () => {
      if (windowEndsAt && windowEndsAt > 0) {
        const remaining = (windowEndsAt - (Date.now() + serverClockOffset)) / 1000;
        setSeconds(Math.max(0, Math.min(PICK_SECONDS, Math.ceil(remaining))));
      } else {
        setSeconds(PICK_SECONDS);
      }
    };
    tick();
    const id = setInterval(tick, 250);
    return () => clearInterval(id);
  }, [windowEndsAt, serverClockOffset]);

  return (
    <div className="flex flex-col items-center gap-4" data-testid="hub-board">
      {/* You — VS + countdown — Opponent (opponent hidden until the terminal reveal beat below).
          Full Spec.html:608 (gap), :616 (VS column width), :618 (countdown float). */}
      <div className="flex items-center justify-center" style={{ gap: cardGap, transition: `gap 620ms ${EXPAND_EASE}` }}>
        <RpsFrame frame={revealDone ? myFrame : FRAME_NEUTRAL} tileBg={tileBg} size={cardW} height={cardH} testid="hub-my-pick-frame">
          <span
            className="flex items-center justify-center transition-[opacity,transform] duration-300 ease-[cubic-bezier(0.34,1.7,0.5,1)]"
            // Ticket 2026-09-12#1 item 2: icon scale 1 → 1.6 at `terminal` (Full Spec.html:3252's
            // `rpsChoice()`, `on ? (big ? 1.6 : 1) : 0.4`) — moved off the old fixed `scale-100`
            // Tailwind class since the "on" scale is no longer a single constant.
            style={{ opacity: myCardChoice ? 1 : 0, transform: `scale(${myCardChoice ? (terminal ? 1.6 : 1) : 0.4})` }}
            data-testid="hub-my-pick-icon"
          >
            {myCardChoice ? <RpsHandIcon choice={myCardChoice} size={70} /> : null}
          </span>
        </RpsFrame>

        <div className="relative flex shrink-0 items-center justify-center" style={{ width: vsWidth, transition: `width 620ms ${EXPAND_EASE}` }}>
          <span
            className="font-bold"
            style={{ fontFamily: ARIAL, fontSize: 16, letterSpacing: 1, color: '#FFFFFF' }}
          >
            VS
          </span>
          {/* Full Spec.html:618 — a 52×52 box centred on the VS column, floated translateY(-42px)
              above it. Ticket 2026-09-25#2 item 1: `rpsClockOp`/`rpsClockScale` (Full Spec.html:
              3749/3803) gate opacity 1→0 / scale 1→0.55 on `rpsPhase !== 'run'` — i.e. the instant
              the pick window closes, same as this file's own `terminal`. `RpsBoard` stays mounted
              through the whole result phase (`suppressResultOverlay`), so unlike a component that
              unmounts at that boundary, the fade is genuinely needed here — confirmed via direct
              read of the citation's own transition list (`opacity 450ms ease, transform 450ms
              cubic-bezier(0.34,1.5,0.5,1)`), Beat 1 (keyed on `terminal` directly, no staging). */}
          <div
            className="pointer-events-none absolute left-1/2 top-1/2"
            style={{
              transform: `translate(-50%, calc(-50% - 42px)) scale(${terminal ? 0.55 : 1})`,
              opacity: terminal ? 0 : 1,
              transition: 'opacity 450ms ease, transform 450ms cubic-bezier(0.34,1.5,0.5,1)',
            }}
          >
            <RpsCountdown seconds={seconds} />
          </div>
        </div>

        {revealStage !== 'grow' && revealActive ? (
          // 2026-09-11#10 item 2 / 2026-09-25#3 item 1: the reveal, relocated in-place from the (now
          // removed) `RpsReveal` overlay component — same `RpsRevealFlipCard`, same 820ms flip
          // (Full Spec.html:625-637), mounted on the persistent board instead of a popup. Shared by
          // BOTH the terminal reveal (stays revealed — the match is over, no reset timer) and an
          // ordinary tie's reveal (the tie's own hold/reset timer above unmounts it later) — the
          // `revealKey`/`terminal ? oppThrow : tieReveal?.oppChoice` branches below are the only
          // per-kind differences. `cardW`/`cardH` are the BIG geometry only when `terminal` — see
          // `rpsExpanded()`'s comment above `cardW`'s declaration for why an ordinary tie keeps the
          // small `CARD_W`/`CARD_H` instead (a deliberately preserved, unchanged decision).
          // Mount gated on `revealStage !== 'grow'` (Beat 2 — the 700ms pause), not `terminal`/
          // `tieReveal` directly — the redacted tile stays put through the pause even though the
          // cards have already grown (terminal case). `frame` stays neutral through 'flip', only
          // taking `oppFrame`'s real color at `revealStage === 'done'` (Beat 3).
          <RpsRevealFlipCard
            key={revealKey}
            frame={revealDone ? oppFrame : FRAME_NEUTRAL}
            tileBg={tileBg}
            choice={terminal ? oppThrow : tieReveal?.oppChoice}
            size={cardW}
            height={cardH}
            testid="hub-opponent-pick-revealed"
          />
        ) : (
          <RpsFrame frame={FRAME_NEUTRAL} tileBg="#4F4CEA" size={cardW} height={cardH}>
            {/* Redaction: never reveal the opponent's choice before match.end (or outside the
                tied-round reveal beat above). Solid #4F4CEA fill + bolt icon (Full Spec.html:628-629,
                2026-09-11#8/C) — not the 🤫 emoji stand-in. */}
            <span data-testid="hub-opponent-pick"><RpsRedactedIcon /></span>
          </RpsFrame>
        )}
      </div>

      {/* Choice buttons — client-local, freely changeable for the whole window (never gated by
          legalMoves/your_turn). The selected throw rings the win-green ring (the selection
          language) — Full Spec.html:645-654 (grid gap:9px) + :3245's `ring` formula.
          Ticket 2026-09-25#2 item 2 (ADVISOR_TO_PM.md): the ring color is now the literal `#16A34A`
          win-green, not `var(--rc-green)` — the RPS/Mines/Dice color-unification rule. Its
          zero-alpha unselected value moved with it (`rgba(22,163,74,0)`, `#16A34A`'s own RGB at
          zero alpha) so the box-shadow color transition still fades cleanly at the SAME hue rather
          than hue-shifting through the old green on its way to the new one.
          Ticket 2026-09-12#1 item 2: at `terminal` the whole row now genuinely COLLAPSES (max-height
          + opacity → 0, Full Spec.html:643's `rpsChoicesH`/`rpsChoicesOp` going to 0px/0 — the outer
          wrapper below owns that, `opacity 450ms ease, max-height 620ms cubic-bezier(0.3,0.9,0.32,1)`,
          the exact transition list at that line) rather than the old dim-to-70%-and-disable
          treatment — there is no round left to pick into, and the prototype's own `rpsChoicesPE`
          drops to `none` too, mirrored here by `pointerEvents`. `disabled` stays on each button as
          defense-in-depth even though the collapsed wrapper already removes them from the hit-test. */}
      <div
        className="w-full overflow-hidden"
        style={{
          opacity: terminal ? 0 : 1,
          maxHeight: terminal ? 0 : 180,
          pointerEvents: terminal ? 'none' : 'auto',
          transition: 'opacity 450ms ease, max-height 620ms ' + EXPAND_EASE,
        }}
      >
        {/* Ticket 2026-09-22#4 (D41): dropped the text label (prototype's own tile markup,
            `Full Spec.html:641-656`, is genuinely just one `<svg>`) and the now-dead-weight `gap-1`;
            added `px-1.5` to match the citation's own `padding:16px 6px` in full. The unselected
            ring is now color-matched zero-alpha (`rgba(52,211,153,0)`, not CSS `transparent`'s
            transparent BLACK) so the box-shadow color transition fades cleanly rather than
            hue-shifting; `ease` (not `ease-out`) matches the citation's own easing curve exactly. */}
        <div className="grid grid-cols-3" style={{ gap: 9 }} role="group" aria-label="RPS choices">
          {RPS_CHOICES.map(({ id, label }) => (
            <button
              key={id}
              type="button"
              onClick={() => handlePick(id)}
              disabled={terminal}
              aria-label={label}
              aria-pressed={myChoice === id}
              data-testid={`hub-move-${id}`}
              data-selected={myChoice === id || undefined}
              className="flex items-center justify-center rounded-[16px] px-1.5 py-4 transition-[background,box-shadow] duration-200 ease hover:brightness-110 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand disabled:cursor-not-allowed disabled:hover:brightness-100"
              style={{
                background: tileBg,
                boxShadow: myChoice === id ? 'inset 0 0 0 3px #16A34A' : 'inset 0 0 0 3px rgba(22,163,74,0)',
              }}
            >
              <RpsHandIcon choice={id} size={54} />
            </button>
          ))}
        </div>
      </div>

    </div>
  );
}

/** The RPS game-area slot: greyed idle preview, or the live board in-match. Full Spec.html:606 —
 *  border-radius:22px, background `minesCardBg` (light `#E9E9F0` / dark `#1A1A2E`, Full Spec.html:3720
 *  — the exact `--rc-surface` pair, so this reads the token instead of re-deriving the same value).
 *
 *  2026-09-11#10 item 2 (ADVISOR_TO_PM.md): also renders `RpsBoard` for the 'result' phase, not just
 *  'in-match' — `suppressResultOverlay` (wired below) means GameHub never swaps to a separate overlay
 *  at match.end, it just keeps rendering THIS slot with `phase` advanced to 'result' and `outcome`
 *  set. Mirrors `CoinflipPanel`'s identical `live = phase === 'in-match' || phase === 'result'` gate —
 *  the same persistent-board pattern, just spelled as a second phase check instead of a `live` const
 *  since RPS's idle/board split was already a ternary rather than one always-mounted subtree.
 *
 *  Ticket 2026-09-12#1 item 1 (ADVISOR_TO_PM.md): fades this whole wrapper to 28% opacity while
 *  `barSlideActive` (threaded through via `GameAreaArgs`, mirroring `GameHub.tsx`'s own flag of the
 *  same name) — matches `rpsBoardOp: rpsMatching ? 0.28 : 1` (`Full Spec.html:3795`) exactly, same
 *  380ms ease transition as the outer `isRps` div itself uses (`:606`). This is what makes the
 *  opponent/own bars sliding toward the VS label (the bar-slide mechanism, `matchBarSlide`) actually
 *  read against a receded table instead of blending into a same-toned board. */
// Ticket 2026-09-25#1 item 3 (ADVISOR_TO_PM.md): `currentMatchId` isn't part of `GameAreaArgs`
// (it lives on the sibling `GameHubScreenProps`), so `RpsHubScreen` below threads it in as an
// extra prop rather than widening the shared interface — the same pattern DiceHub.tsx uses for
// its own extra per-game signal. Keys `RpsBoard`'s mount so two consecutive matches (RPS runs
// `searchFloorMs={0}`, so an instant bot rematch is real) always get a fresh instance instead of
// reusing the same one — `rps.ts`'s `round` field restarts at 0 for every new match (only bumping
// on a tie-replay), so `optimisticPick`'s own `[round]`-keyed reset effect never re-fires across a
// match boundary without this: the previous match's selection ring would otherwise stay lit into
// the new one until the player tapped again.
function RpsPanel({ currentMatchId, ...args }: GameAreaArgs & { currentMatchId: string | null }) {
  const showBoard = args.phase === 'in-match' || args.phase === 'result';
  return (
    <div
      data-testid="hub-rps-panel"
      className="rounded-[22px] bg-[var(--rc-surface)] p-4"
      style={{ opacity: args.barSlideActive ? 0.28 : 1, transition: 'opacity 380ms ease' }}
    >
      {showBoard ? <RpsBoard key={currentMatchId ?? 'idle'} {...args} /> : <RpsIdle />}
    </div>
  );
}

/** The opponent's reveal card: a 3D flip from the redacted blue-bolt face to the resolved throw, matching
 *  Full Spec.html:625-637 — `perspective:900px` (:625) on the frame, `rotateY(0 → 180deg)` over
 *  820ms `cubic-bezier(0.42,0.04,0.24,1)` (:626) on the inner flip, `backface-visibility:hidden` on
 *  both faces (:627/:632) so only one ever shows. Only the OPPONENT's card flips — my own choice was
 *  never hidden from me, so it renders resolved immediately (its frame just recolors — see
 *  `RpsBoard`'s own card above), the same asymmetry the prototype's own `rpsLeftFrame`/`rpsFlipRot`
 *  split encodes (only the right/opponent card carries `rpsFlipRot`).
 *
 *  `RpsBoard` is the only caller (2026-09-11#10 item 2 relocated this from a separate `RpsReveal`
 *  overlay component, since removed, into the persistent board itself) — both its tied-round reveal
 *  (2026-09-11#9 item 2, always the small `CARD_W`/`CARD_H`) and its terminal reveal (2026-09-12#1
 *  item 2, the big `cardW`/`cardH` once `terminal`) pass the size explicitly so the card always
 *  matches the live board's own rectangular frame at that moment; no default size remains since
 *  there's no longer a separate, smaller overlay-card usage to default for. The flip itself plays
 *  once per MOUNT (fixed `initial`/`animate` values) — callers that need it to replay must remount
 *  via a changing `key`, which `RpsBoard` does per tie (the terminal reveal never needs to replay —
 *  it's keyed once and stays).
 *
 *  Ticket 2026-09-25#2 item 1 (ADVISOR_TO_PM.md): the translateX 16px-then-back nudge (Full
 *  Spec.html:625/3091/3808 — `rpsFlipX`, `transform 410ms ease-in-out`) lives here rather than in
 *  `RpsBoard`, since it's shared by BOTH the terminal reveal and the mid-match tie-reveal below —
 *  one change covers both call sites for free. `slide` starts `true` (matching `rpsSlide: true` set
 *  the same instant the prototype's own flip begins) and flips to `false` 410ms after mount; since
 *  this component only ever mounts at the moment its own flip starts (fresh per `key`, per the doc
 *  above), a plain mount-time effect reproduces the prototype's "nudge starts exactly when the flip
 *  does" timing without needing to coordinate with `RpsBoard`'s own `revealStage`. */
function RpsRevealFlipCard({ frame, tileBg, choice, size, height, testid }: { frame: string; tileBg: string; choice: string | undefined; size: number; height: number; testid?: string }) {
  const [slide, setSlide] = useState(true);
  useEffect(() => {
    const t = setTimeout(() => setSlide(false), 410);
    return () => clearTimeout(t);
  }, []);
  return (
    <div
      data-testid={testid}
      className="shrink-0 rounded-[14px] p-[6px] shadow-[0_6px_16px_rgba(0,0,0,0.28)]"
      // Ticket 2026-09-12#1 item 2: same width/height growth as `RpsFrame` above (Full Spec.html:625's
      // transition list — width/height 620ms cubic-bezier(0.3,0.9,0.32,1), background 420ms ease).
      style={{
        width: size,
        height,
        background: frame,
        perspective: 900,
        transform: `translateX(${slide ? '16px' : '0px'})`,
        transition: `background 420ms ease, width 620ms ${EXPAND_EASE}, height 620ms ${EXPAND_EASE}, transform 410ms ease-in-out`,
      }}
    >
      <motion.div
        className="relative h-full w-full"
        style={{ transformStyle: 'preserve-3d' }}
        initial={{ rotateY: 0 }}
        animate={{ rotateY: 180 }}
        transition={{ duration: 0.82, ease: [0.42, 0.04, 0.24, 1] }}
      >
        {/* Front/hidden face — same solid #4F4CEA + bolt treatment as the non-flipping redacted
            tiles above (Full Spec.html:628-629), always this color regardless of theme, unlike the
            back/revealed face below which uses the theme-conditional `tileBg`. */}
        <div
          className="absolute inset-0 flex items-center justify-center overflow-hidden rounded-[9px]"
          style={{ background: '#4F4CEA', backfaceVisibility: 'hidden' }}
        >
          <RpsRedactedIcon />
        </div>
        <div
          className="absolute inset-0 flex items-center justify-center overflow-hidden rounded-[9px]"
          style={{ background: tileBg, backfaceVisibility: 'hidden', transform: 'rotateY(180deg)' }}
        >
          <RpsHandIcon choice={choice} size={70} />
        </div>
      </motion.div>
    </div>
  );
}

/**
 * RPS Hub = the shared GameHub + an RPS play-panel (rock/paper/scissors + redaction), presenting
 * its result in place on the board itself rather than a separate pop-up.
 *
 * 2026-09-11#10 item 2 (ADVISOR_TO_PM.md): the prototype has NO separate full-screen result modal
 * for this game anywhere in `Full Spec.html` — win/lose is communicated entirely in-place: the
 * player's own card frame turns green/red/orange, the opponent's reveal card 3D-flips in place (same
 * DOM node throughout), and both cards enlarge (2026-09-12#1 item 2, `rpsExpanded()`). This hub wires
 * `suppressResultOverlay` (`CoinflipHub.tsx:339-341`'s reference pattern) so GameHub never renders
 * the separate `ResultOverlay`; it holds the result phase open with `RpsBoard` still mounted (see
 * `RpsPanel` above) so the terminal reveal — relocated from the removed `RpsReveal` overlay component
 * into `RpsBoard` itself — plays on the board in place of a popup.
 *
 * Ticket 2026-09-25#3 item 2 (ADVISOR_TO_PM.md): `ownBarResult`+`gateResultOnReveal` are now WIRED —
 * REVERSING ticket 2026-09-12#1 item 3's earlier removal, on new information, not a re-litigation of
 * that correction. 2026-09-12#1 item 3 was right that the prototype's own `mOutcome` (`gameV = view
 * === 'mines' || isDice`, `Full Spec.html:3519`) never includes RPS — the prototype genuinely never
 * puts a bar treatment on RPS. This ticket is Designer's own EXPLICIT, deliberate departure from
 * that prototype behavior for THIS build specifically — confirmed directly against Designer's own
 * report, not inferred — asking for the exact Dice-style ring+fill+"you won" text RPS never had.
 * `GameHub.tsx`'s `OwnSlot` already implements everything this needs (built for Dice); RPS copies
 * the same `winRingColor`/`winFillColor`/`lossRingColor` values as the card frames just above
 * (`#16A34A`/`#16A34A`/`var(--rc-loss)`, ticket 2026-09-25#2 item 2), gated by `gameId === 'rps'`
 * alongside Dice/Mines in `GameHub.tsx`. `gateResultOnReveal` (not the fixed generic beat) lets
 * `RpsBoard` light the bar itself, from its own `revealStage`, the instant its own reveal — win,
 * lose, OR the rare replay-cap void — reaches 'done' (`onRevealComplete`), never ahead of it. An
 * ordinary mid-match tie never lights this at all: `phase` never reaches `'result'` during one
 * (`GameHub.tsx`'s own `phase` formula), and `RpsBoard` itself only ever calls `onRevealComplete`
 * when `terminal` is true — see that component's own doc comment for why calling it from a tie's
 * own 'done' would corrupt the LATER genuine terminal reveal's own gating.
 *
 * Ticket 2026-09-25#3: also wires `suppressDrawBar` — the SAME flag `BlackjackHub.tsx` already uses
 * for the identical reason. The shared, game-agnostic `drawBeat` mechanism (`GameHub.tsx:762-788`,
 * #161) pulses an orange outline on BOTH bars on every rise in the public `replays` counter, for
 * every pick-based tie-replay game — this predates and is UNRELATED to `ownBarResult`/`myFrame`/
 * `oppFrame` above (it fires even when `ownBarResult` is unset, as it did before this ticket). Now
 * that RPS shows every tie via its own card frames (orange, via `RpsBoard`'s `tieReveal`-driven
 * `myFrame`/`oppFrame`), the generic bar pulse is a redundant, uncoordinated second signal — the
 * exact root cause of Designer's own "yellow rings on both bars" report, confirmed directly rather
 * than assumed. The board still receives the full `drawBeat` via `areaArgs` regardless (unused by
 * RPS today; `suppressDrawBar` only silences the BAR's own copy, matching Blackjack's own pattern).
 *
 * Deliberately still NOT wiring `holdResultMs` (unlike Coinflip's `HOLD_RESULT_MS={2600}`): Coinflip
 * needs it because its coin's flip visual is gated on `gameState` directly (immediate at match end)
 * while `holdResultMs` only delays the BAR (`phase`/`outcome`) behind it, giving the ~1.8-2.4s coin
 * flip room to land first. RPS's terminal reveal is gated on `outcome` itself (see `RpsBoard`'s doc
 * comment for why — `RpsView`'s client type carries no `winner` field to derive it from `gameState`
 * directly), so an added hold would delay the FLIP'S OWN START by the same amount, not just the bar —
 * doubling total reveal latency instead of sequencing it. Without a hold, `outcome`/phase='result'
 * land essentially the same tick the match ends; `gateResultOnReveal` alone already keeps the BAR
 * itself waiting for `RpsBoard`'s own `revealStage` to finish, which is all `holdResultMs` would
 * otherwise exist to approximate here.
 */
export function RpsHubScreen(props: GameHubScreenProps) {
  return (
    <GameHub
      renderGameArea={(args) => <RpsPanel {...args} currentMatchId={props.currentMatchId} />}
      gameId="rps"
      gameName="Rock Paper Scissors"
      suppressResultOverlay
      // Ticket 2026-09-25#3 item 2 (ADVISOR_TO_PM.md): `ownBarResult`+`gateResultOnReveal`+
      // `suppressDrawBar` — see the doc comment above this component for the full citation chain
      // (a deliberate divergence from the prototype, on new information, not a re-litigation of
      // 2026-09-12#1 item 3's earlier removal of `ownBarResult` alone).
      ownBarResult
      gateResultOnReveal
      suppressDrawBar
      // Ticket 2026-09-11#9 (ADVISOR_TO_PM.md), a DELIBERATE REVERSAL of #387's `searchFloorMs={0}`
      // above — not a regression, not new information #387 missed. #387's reasoning was real: RPS's
      // entire round IS the server's fixed 10s pick window (PICK_WINDOW_MS, `packages/games/rps/src/
      // rps.ts`'s `launch()`, resolves ONLY at expiry — never early), and `windowEndsAt` is stamped
      // at real match formation (`packages/core/src/matchmaking.ts`'s `joinQueue`/`takeChallenge`),
      // essentially the same instant `currentMatchId` reaches this client — so every ms this floor
      // holds `phase` at 'waiting' is a ms carved directly out of the player's SEEN, interactive share
      // of that already-ticking 10s window, not just a cosmetic pre-match delay. Owner directed this
      // reversal anyway, explicitly accepting that tradeoff: at this stage, matching the prototype's
      // ~3.8s search→found→split beat (`startRps()`, `Full Spec.html:3291-3313`) outweighs maximizing
      // the player's real picking time. In the common case (bot-crowd pairs near-instantly) this
      // leaves roughly 10 - 3.8 = ~6.2s of the window actually visible/tappable — the round itself is
      // NOT shortened (the server deadline is untouched, and the existing seeded auto-throw at
      // `windowEndsAt` — untouched by this change — still resolves gracefully if a player runs out of
      // visible time), only the player's own reaction window within it. Do not "fix" this back to 0
      // without Owner sign-off; see the mailbox entry for the full rationale.
      searchFloorMs={3800}
      // Ticket 2026-09-11#10 item 1: the flat-magnitude fallback the prototype's own `startRps()`
      // uses (it never measures the DOM, unlike `startMines()`/`startDice()`) — `Full Spec.html:3754`
      // (`!gameV` branch), `123`/`-123` for the opponent/player bar.
      matchBarSlide={123}
      {...props}
    />
  );
}
