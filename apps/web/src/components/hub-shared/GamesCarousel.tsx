import { useEffect, useMemo, useRef, useState, type UIEvent } from 'react';
import type { OpenChallenge, PublicOpenChallenge, VipTier } from '@rapidclash/shared';
import { api } from '../../api.js';
import { useTheme } from '../../lib/theme.js';
import { useCurSel } from '../../lib/currency.js';
import { TILE_ART, titleCase } from './tiles.js';
import { Avatar } from './Avatar.js';
import { mergeChallengesByGame, insufficientBalanceNotice, PUBLIC_POLL_MS, type FeedRow } from './OpenGames.js';
import { RcIcon } from './RcIcon.js';
import { TierIcon } from './vipTier.js';
import { CurrencyIcon } from '../hub-chrome/CurrencyPicker.js';
import { OPEN_CURS } from '../hub-chrome/currencyData.js';

/**
 * Games-page "Open Games" carousel (issue #305, `docs/COMMS/from-advisor/games-and-rewards.md`
 * §A). Source: the Designer's export, decoded from `design-ref/games-and-rewards/RapidClash -
 * Games and Rewards.html` (gitignored — a `<script type="__bundler/template">` JSON-escaped
 * blob at line 382; the `Component` class's `componentDidMount`/`tick()`/`make()`/`boardRows()`/
 * `raceClock()` sit around decoded-line 1183-1540, the JSX markup around decoded-line 480-611).
 * Facts transcribed here so they survive the design-ref worktree being gitignored/removed, per
 * `WORKING_AGREEMENT.md`'s gitignored-artifact rule:
 *
 * - Tabs: `TABS = ['OPEN GAMES', '24H RACE', 'WEEKLY RACE', 'LEADERBOARDS']` (ticket
 *   2026-09-13#6 item 1 fixed a transcription bug: this used to read 'RANK', which appears
 *   nowhere in the prototype's own `TABS` array — the internal `'rank'` board-kind string
 *   `buildBoardRows` uses is just a discriminator, not user-facing, and is unaffected), `state.tab`
 *   picks one; picking a tab also resets `boardLimit` to 10.
 * - OPEN GAMES motion (verbatim, not retuned): `ROW = 76`, `VISIBLE = 11`, a 1900ms
 *   `setInterval` tick. Each tick prepends a fresh row and drops the oldest, then plays a
 *   two-`requestAnimationFrame` slide-in: frame 1 snaps the wrapper to `translateY(-ROW)` with
 *   `transition: 0ms` (invisible — visually identical to the settled frame), frame 2 animates to
 *   `translateY(0)` over 620ms with `cubic-bezier(0.22,0.61,0.36,1)`.
 * - `make()`'s synthetic `POOL`/`STAKES` row-building is replaced with real open-challenge rows
 *   (issue #305: "reuse the existing feed, don't build a new path") — the same
 *   `challengesByGame` WS aggregate / public-poll snapshot the now-retired `OpenGamesTicker`/
 *   `PublicOpenGamesTicker` used to consume (issue #316 deleted both once this component became
 *   the one Open Games implementation everywhere), via the shared `mergeChallengesByGame`/
 *   `PUBLIC_POLL_MS` helpers still exported from `OpenGames.tsx`. Game art comes from the existing
 *   `TILE_ART` map (not the design's own `IMGS`, which points at design-tool asset paths this app
 *   doesn't have). JOIN reuses `insufficientBalanceNotice`, the same affordability rule/copy.
 * - The design's `MODES` placeholder array is dead in the file itself (never read by `make()`)
 *   — nothing to wire for it, confirmed by grepping the decoded template.
 * - 24H RACE / WEEKLY RACE / RANK (tabs 1-3) render the design's own static placeholder arrays
 *   (`RACE_24H`/`RACE_WEEK`/`RANKS`, transcribed verbatim below) via `boardRows()`/`raceClock()`
 *   — no backend, ever (Owner decision, games-and-rewards.md §"Owner decisions" #1: races/rank
 *   are out of `CHARTER.md`'s current scope). The countdown clock is presentational only, ticking
 *   off the real wall clock exactly like the design's own `raceClock()` (a target-time
 *   calculation, not fabricated data) — it doesn't count down towards anything a rewards backend
 *   settles.
 *
 * Judgment calls (flagged for the Advisor's pixel-diff pass, not silent deviations):
 * 1. **Real-data empty state.** The design's synthetic `POOL` is always non-empty, so its
 *    `tick()`/constructor never had to handle zero rows. A real feed can genuinely be empty (no
 *    open challenges anywhere) — added a plain empty-state message instead of animating an empty
 *    list, and the tick interval simply doesn't run while the pool is empty.
 * 2. **Eager initial seed.** The design's constructor synchronously fills all 11 rows because its
 *    POOL is a constant, always fully available. A real feed arrives async (WS subscribe / first
 *    poll) and can start empty — seeded the initial 11-row window the moment the live pool first
 *    becomes non-empty, rather than waiting up to `VISIBLE * TICK_MS` (~21s) for `tick()` to fill
 *    it one row at a time. The 1900ms tick cadence itself is untouched once seeded.
 * 3. **`LIVE` count is the real open-challenge count**, not the design's synthetic
 *    `20 + ((liveCount + 3) % 17)` cycle — a fabricated number would misrepresent real backend
 *    state on a page whose entire point (this ticket) is wiring it to real data.
 * 4. **Race/rank avatars.** The design points at `assets/avatar-N.jpg`, images that were never
 *    part of the 20 real assets the Designer actually exported (verified against issue #304's
 *    asset audit) — they're placeholder references the design tool itself never resolved. Reused
 *    this app's existing derived-color `Avatar` component (already the "no real image" fallback
 *    used everywhere else a user is shown) instead of fabricating new placeholder art.
 * 5. **Stake/prize/XP numerals always show a `$`-prefixed amount** (ticket 2026-09-13#6 item 2,
 *    correcting 2026-09-11#8 item B.2 with more precise Designer detail: that ticket's own green
 *    "RC" coin glyph for logged-out viewers is retired here — every row, logged in or out, reads
 *    `$amount`), with a small decorative currency-symbol icon next to it (`CurrencyIcon`, reused
 *    from `hub-chrome/CurrencyPicker.tsx` rather than rebuilt) via the `AmountFigure` helper
 *    below. A registered viewer's icon matches the wallet's shared, app-wide selected currency
 *    (`lib/currency.ts`'s `curSel` singleton); a logged-out viewer's icon is picked per row from
 *    `OPEN_CURS`, stable (hashed off the row's own identity — `matchId` for the live feed, the
 *    board row's own `key` for the static RACE/RANK boards — never re-randomized on re-render).
 * 6. **Interactive elements are real `<button>`s**, not the design's plain `<div>`/`<span>` with
 *    `onClick` — matching this codebase's existing precedent for every other design-transcribed
 *    interactive control (`HomeHub.tsx`'s `CategoryTabs`/`GridControls`, etc.). Unlike the
 *    Bring-a-Rival banner's marketing CTA (deliberately a non-focusable div, Owner-confirmed
 *    issue #301), JOIN/tab-pick/VIEW MORE here perform real stake-taking/navigation actions, so
 *    keyboard/AT reachability follows the app's functional-control precedent, not the marketing
 *    one.
 */

const TABS = ['OPEN GAMES', '24H RACE', 'WEEKLY RACE', 'LEADERBOARDS'];

// Carousel motion constants — transcribed verbatim (decoded template lines 1293-1341). Do not
// retune: 1900ms tick, 76px row height, an 11-row rolling window, 620ms slide-in.
const ROW = 76;
const VISIBLE = 11;
const TICK_MS = 1900;
const SLIDE_MS = 620;

// RACE_24H / WEEKLY / RANKS — [username, metric, prize|tier] tuples, transcribed verbatim from
// the decoded template (lines 1255-1292). Static/decorative only — see file header judgment call.
type BoardTuple = [string, number, number | string];

const RACE_24H: BoardTuple[] = [
  ['dxbn', 4820, 1500], ['moonshot', 4115, 900], ['highroller', 3760, 600],
  ['crazypov', 3240, 400], ['gambit', 2890, 250], ['sweeper', 2410, 150],
  ['rocketman', 2075, 100], ['splitaces', 1830, 75], ['hitme', 1495, 50],
  ['tileflip', 1120, 25], ['nightowl', 1040, 25], ['pipfarm', 985, 25],
  ['zenmode', 930, 25], ['bluffcity', 880, 25], ['fastlane', 835, 20],
  ['coinflipper', 790, 20], ['minerboy', 745, 20], ['redstack', 700, 20],
  ['skyhook', 660, 20], ['tapout', 615, 20], ['bigshortie', 575, 15],
  ['lastcall', 530, 15], ['runitup', 495, 15], ['ghostpip', 455, 15],
  ['jokerz', 420, 15], ['saltyrun', 385, 15], ['deepstack', 350, 10],
  ['mrsteady', 315, 10], ['clutchking', 280, 10], ['sidebet', 250, 10],
];

const RACE_WEEK: BoardTuple[] = [
  ['ramunas', 28450, 8000], ['cryptobloke', 24180, 5000], ['chessking', 21730, 3000],
  ['degen', 18960, 2000], ['knightfall', 16240, 1200], ['luckylou', 14870, 800],
  ['boomboom', 12530, 600], ['dealerdan', 10940, 400], ['greenline', 9280, 250],
  ['cashout', 7610, 150], ['ironjaw', 6940, 120], ['pixelpit', 6380, 120],
  ['nova', 5820, 120], ['tradezilla', 5310, 100], ['bettybold', 4870, 100],
  ['coldstreak', 4420, 100], ['viperx', 4010, 80], ['rollwithit', 3660, 80],
  ['papercut', 3310, 80], ['midnight', 2980, 60], ['acehunter', 2690, 60],
  ['sandbagger', 2410, 60], ['quickdraw', 2170, 50], ['loosewire', 1930, 50],
  ['sharkbait', 1720, 50], ['bankroll', 1510, 40], ['tinyraise', 1330, 40],
  ['flopgod', 1160, 40], ['sidepot', 1010, 40], ['halfstack', 880, 30],
];

const RANKS: BoardTuple[] = [
  ['dxbn', 96400, 'DIAMOND'], ['ramunas', 82150, 'DIAMOND'], ['cryptobloke', 71300, 'PLATINUM'],
  ['moonshot', 63820, 'PLATINUM'], ['chessking', 54190, 'GOLD'], ['degen', 47630, 'GOLD'],
  ['crazypov', 39480, 'GOLD'], ['superble', 31250, 'SILVER'], ['gambit', 24870, 'SILVER'],
  ['tombrady', 18340, 'BRONZE'], ['nova', 17620, 'BRONZE'], ['ironjaw', 16880, 'BRONZE'],
  ['pixelpit', 16110, 'BRONZE'], ['viperx', 15340, 'BRONZE'], ['bettybold', 14580, 'BRONZE'],
  ['coldstreak', 13820, 'BRONZE'], ['midnight', 13070, 'BRONZE'], ['acehunter', 12310, 'BRONZE'],
  ['quickdraw', 11560, 'BRONZE'], ['sharkbait', 10800, 'BRONZE'], ['bankroll', 10050, 'BRONZE'],
  ['flopgod', 9290, 'BRONZE'], ['sidepot', 8540, 'BRONZE'], ['tinyraise', 7780, 'BRONZE'],
  ['loosewire', 7030, 'BRONZE'], ['papercut', 6270, 'BRONZE'], ['rollwithit', 5520, 'BRONZE'],
  ['sandbagger', 4760, 'BRONZE'], ['tradezilla', 4010, 'BRONZE'], ['halfstack', 3280, 'BRONZE'],
];

/** The circular race-progress ring's dasharray — a fixed decorative value in the design (not
 *  driven by any real progress), transcribed verbatim (decoded line 1516). */
const RACE_DASH = `${(2 * Math.PI * 29 * 0.62).toFixed(1)} ${(2 * Math.PI * 29).toFixed(1)}`;

/** `raceClock()` — transcribed verbatim (decoded lines 1367-1387). A presentational countdown to
 *  a fixed daily/weekly target time, computed off the real wall clock (`now`); not derived from
 *  any backend race state (there is none — see Owner decision #1). */
function computeRaceClock(tab: number, now: number): { v: string; u: string }[] {
  let end: number;
  if (tab === 1) {
    const e = new Date(now);
    e.setHours(16, 0, 0, 0);
    let endMs = e.getTime();
    if (endMs <= now) {
      e.setDate(e.getDate() + 1);
      endMs = e.getTime();
    }
    end = endMs;
  } else {
    const e = new Date(now);
    e.setHours(0, 0, 0, 0);
    const days = (8 - e.getDay()) % 7 || 7;
    e.setDate(e.getDate() + days);
    end = e.getTime();
  }
  let s = Math.max(0, Math.floor((end - now) / 1000));
  if (tab === 1) s = Math.min(s, 86399);
  const d = Math.floor(s / 86400);
  s -= d * 86400;
  const h = Math.floor(s / 3600);
  s -= h * 3600;
  const m = Math.floor(s / 60);
  s -= m * 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  const out = [{ v: pad(h), u: 'H' }, { v: pad(m), u: 'M' }, { v: pad(s), u: 'S' }];
  return tab === 1 ? out : [{ v: pad(d), u: 'D' }, ...out];
}

/** Re-renders once a second so `computeRaceClock` reflects the real, ticking wall clock — mirrors
 *  the design's `this.clockTimer = setInterval(() => this.forceUpdate(), 1000)` (decoded line
 *  1321), which runs for the component's whole lifetime, not gated on the active tab. */
function useNowTick(intervalMs: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

/** `railMask(l, r)` — transcribed verbatim (ticket 2026-09-13#6 item 1, `Full Spec.html:3503-
 *  3508`). Replaces the tab rail's old two-overlay-div fade technique (mismatched with this
 *  rail's own spec, which is `mask-image`-based — the overlay-div technique belongs to the
 *  category rail, 2026-09-13#1, a different rail entirely) with a single gradient applied as the
 *  scroller's own `mask-image`/`-webkit-mask-image`, computed from the same `leftFade`/
 *  `rightFade` (0-1) state `onTabScroll` already tracks. */
function railMask(l: number, r: number): string {
  const a = Math.round(Math.max(0, Math.min(1, l || 0)) * 34);
  const b = Math.round(Math.max(0, Math.min(1, r ?? 1)) * 34);
  if (!a && !b) return 'none';
  return `linear-gradient(to right, rgba(0,0,0,0) 0px, #000 ${a}px, #000 calc(100% - ${b}px), rgba(0,0,0,0) 100%)`;
}

interface BoardRow {
  key: string;
  username: string;
  name: string;
  sub: string;
  placeNum: number;
  showPlaceNum: boolean;
  label: string;
  value: string;
  showValue: boolean;
  pill: string;
  showPrize: boolean;
  bg: string;
  radius: string;
}

/** `boardRows()` — transcribed verbatim (decoded lines 1343-1365), minus the dead `avatar`/
 *  `avatarBg`/`avatarFill`/`place` fields (never read by the rendered markup — confirmed by
 *  grepping the decoded template) and the image-URL avatar (see judgment call #4 above). */
function buildBoardRows(src: BoardTuple[], kind: 'race' | 'rank'): BoardRow[] {
  return src.map(([username, metric, third], i) => ({
    key: `${kind}-${i}-${username}`,
    username,
    name: `@${username}`,
    sub: kind === 'rank' ? String(third) : `${metric.toLocaleString('en-US')} XP earned`,
    placeNum: i + 1,
    showPlaceNum: kind !== 'rank',
    label: kind === 'rank' ? 'XP:' : '',
    value: metric.toLocaleString('en-US'),
    showValue: kind === 'rank',
    pill: kind !== 'rank' ? Number(third).toLocaleString('en-US') : '',
    showPrize: kind !== 'rank',
    bg: i % 2 === 0 ? '#1A1A2E' : 'transparent',
    radius: i % 2 === 0 ? '26px' : '0px',
  }));
}

/** One rolling row in the OPEN GAMES carousel — the design's synthetic `make()` return shape
 *  (decoded lines 1305-1317), with real data substituted for `POOL`/`STAKES` per issue #305.
 *
 *  `ownerTier` (ticket 2026-09-13#6 item 3, Owner-decided): `OpenChallenge`/`PublicOpenChallenge`
 *  (`packages/shared/src/protocol.ts`) now carry a server-resolved `ownerTier` field for every
 *  row — 2026-09-11#8 item B.3's "no tier field over the wire" gap is closed. Rendered via
 *  `TierIcon`, for every host, bot or human alike (the Owner's explicit call: bots are real
 *  funded accounts per ADR-010, so a bot's own real, if typically low, tier is meaningful to
 *  show — no fake tier needed). This REPLACES the 🤖 disclosure emoji that used to sit in front
 *  of a bot's `@handle` — see `displayHostName` below for why that emoji is now stripped from
 *  what's rendered (the underlying `ownerName` data itself is untouched). */
interface CarouselRow {
  uid: number;
  matchId: string;
  gameId: string;
  gameName: string;
  host: string;
  ownerTier: VipTier;
  stake: number;
  /** `uid % 2 === 0` — the design's alternating "elevated pill" background (decoded line 1314). */
  zebra: boolean;
}

/** Real pool for the carousel to draw from: the signed-in WS aggregate when logged in (the
 *  `challengesByGame` prop, same shape every hub already passes), or the same public-poll
 *  snapshot when logged out — one feed, one cadence, no new data path. */
function useOpenChallengesPool(challengesByGame: Record<string, OpenChallenge[]>, loggedIn: boolean): FeedRow[] {
  const [publicRows, setPublicRows] = useState<PublicOpenChallenge[]>([]);

  useEffect(() => {
    if (loggedIn) return;
    let alive = true;
    const load = () => api.openChallenges().then((r) => { if (alive && Array.isArray(r)) setPublicRows(r); }).catch(() => {});
    load();
    const id = setInterval(load, PUBLIC_POLL_MS);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [loggedIn]);

  return useMemo(() => {
    if (loggedIn) return mergeChallengesByGame(challengesByGame);
    return [...publicRows].sort((a, b) => a.openedAt - b.openedAt).map((c) => ({ gameId: c.gameId, c }));
  }, [loggedIn, challengesByGame, publicRows]);
}

/**
 * The OPEN GAMES tab's rolling window + motion state machine — `componentDidMount`/`tick()`/
 * `make()` transcribed verbatim (decoded lines 1296-1341) into a hook, with `make()`'s synthetic
 * `POOL`/`STAKES` row-building replaced by real rows drawn from the live `pool` (issue #305). The
 * interval/rAF timing is untouched; only the *data* `make()` reaches for is real. See judgment
 * calls #1-#3 in the file header for the real-data adaptations (empty state, eager seed, real
 * LIVE count) the design's always-full synthetic POOL never had to handle.
 */
/**
 * Docs/COMMS/ADVISOR_TO_PM.md 2026-09-11#8 item B.1 fixed a doubled-`@` display bug here; ticket
 * 2026-09-13#6 item 3 (Owner-decided) now ALSO strips the leading 🤖 disclosure emoji from what's
 * RENDERED, replacing it with a `TierIcon` next to the (now emoji-free) `@handle` — for every
 * host, bot or human alike. This is a display-only change: bot-crowd's own stored `ownerName`
 * (`` `${BOT_PREFIX}@sweeper` ``, `tools/bot-crowd/src/config.ts`) is read here but never
 * mutated anywhere in this component — `tools/bot-crowd`'s own `isTakeable`/naming logic, which
 * depends on the RAW `ownerName` starting with `BOT_PREFIX`, keeps working exactly as today.
 *
 * Previously (see git history) this function deliberately preserved the 🤖 emoji, citing
 * ADR-010's informed-consent requirement: a real player choosing whether to JOIN a bot-hosted
 * match should be able to tell. The Owner's explicit call on this ticket supersedes that for THIS
 * screen specifically: ADR-010's real-world informed-consent requirement doesn't meaningfully
 * apply to a pure investor demo with no real games, and bots are real funded accounts in this
 * system anyway (ADR-010 itself: "bots are ordinary 🤖-labelled clients") — so a bot's own real
 * (if typically low) VIP tier is a meaningful, honest thing to show in the emoji's place, not a
 * silent removal of the disclosure. Deliberately dropped from the `aria-label` too (`:~651`), not
 * just the visible text — the reasoning above is "this disclosure doesn't carry real stakes on
 * this demo screen," which applies equally to sighted and AT users; keeping it in one but not the
 * other would be an inconsistent half-measure, not a deliberate choice.
 *
 * The stripping logic below is now equivalent to `ProfileHub.tsx`'s own `normalizeOpponentName`
 * (issue #441) — the two helpers used to differ specifically because of the ADR-010 reasoning
 * this comment just walked back for this screen; now that the reasoning no longer applies here
 * either, converging on the same shape is expected, not a coincidence.
 */
function displayHostName(ownerName: string): string {
  return `@${ownerName.replace(/^🤖\s*/, '').replace(/^@/, '')}`;
}

function useOpenGamesCarousel(pool: FeedRow[], nameByGame: Map<string, string>) {
  const poolRef = useRef(pool);
  poolRef.current = pool;
  const nameByGameRef = useRef(nameByGame);
  nameByGameRef.current = nameByGame;
  const nRef = useRef(0);

  function make(): CarouselRow | null {
    const p = poolRef.current;
    if (p.length === 0) return null;
    const row = p[nRef.current % p.length];
    const uid = nRef.current++;
    return {
      uid,
      matchId: row.c.matchId,
      gameId: row.gameId,
      gameName: nameByGameRef.current.get(row.gameId) ?? titleCase(row.gameId),
      host: displayHostName(row.c.ownerName),
      ownerTier: row.c.ownerTier,
      stake: row.c.stake,
      zebra: uid % 2 === 0,
    };
  }

  const [items, setItems] = useState<CarouselRow[]>([]);
  const [offset, setOffset] = useState(0);
  const [dur, setDur] = useState('0ms');
  const hasPool = pool.length > 0;

  // Judgment call #2 (file header): seed all VISIBLE rows the moment real data first arrives,
  // rather than waiting for `tick()` to fill them one at a time.
  useEffect(() => {
    if (!hasPool) {
      setItems([]);
      return;
    }
    setItems((prev) => {
      if (prev.length > 0) return prev;
      const seeded: CarouselRow[] = [];
      for (let i = 0; i < VISIBLE; i++) {
        const row = make();
        if (row) seeded.unshift(row);
      }
      return seeded;
    });
    // Seed only on the empty→non-empty edge; make() reads the live pool via a ref, so a
    // populated pool's ongoing content changes are picked up by tick() below, not here.
    // eslint-disable-next-line
  }, [hasPool]);

  // tick() — verbatim (decoded lines 1330-1341): every TICK_MS, prepend a fresh row and drop the
  // oldest, then the two-rAF slide-in. Runs for the whole component lifetime once real data
  // exists, regardless of which tab is active — matching componentDidMount, not gated on tab.
  useEffect(() => {
    if (!hasPool) return;
    let raf1: number | null = null;
    let raf2: number | null = null;
    const timer = setInterval(() => {
      const row = make();
      if (!row) return;
      setItems((prev) => [row, ...prev.slice(0, VISIBLE - 1)]);
      setOffset(-ROW);
      setDur('0ms');
      raf1 = requestAnimationFrame(() => {
        raf2 = requestAnimationFrame(() => {
          setOffset(0);
          setDur(`${SLIDE_MS}ms`);
        });
      });
    }, TICK_MS);
    return () => {
      clearInterval(timer);
      if (raf1 !== null) cancelAnimationFrame(raf1);
      if (raf2 !== null) cancelAnimationFrame(raf2);
    };
    // Re-armed only on the empty↔non-empty edge (mirrors componentDidMount's one-time
    // setInterval); make() reads the live pool/nameByGame via refs, not via this dependency list.
    // eslint-disable-next-line
  }, [hasPool]);

  return { items, offset, dur };
}

/** A small, deterministic string hash (djb2-ish) — used ONLY to pick a stable, non-reshuffling
 *  `OPEN_CURS` index for a logged-out row's decorative currency icon (ticket 2026-09-13#6 item 2),
 *  the same role the prototype's own numeric `it.uid` plays in `OPEN_CURS[it.uid % OPEN_CURS.
 *  length]`. This component's own `uid` field can't be reused for that: it's a monotonically
 *  increasing per-TICK slot counter (`nRef.current++` in `make()`), so the SAME underlying
 *  challenge gets a DIFFERENT `uid` every time it cycles back into the rolling window — using it
 *  here would make the icon reshuffle on every tick, exactly what Designer's spec forbids. Hashing
 *  a row's own stable string identity (`matchId` for the live feed, a board row's own `key` for
 *  the static RACE/RANK boards) instead keeps the same row always mapping to the same icon. */
function stableIndex(id: string, mod: number): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0;
  return Math.abs(h) % mod;
}

/** Which currency symbol a row's decorative icon should show (ticket 2026-09-13#6 item 2,
 *  prototype's own `cur: loggedIn ? curSel : OPEN_CURS[it.uid % OPEN_CURS.length]`, confirmed via
 *  grep): a registered viewer sees the SAME symbol on every row, matching the wallet's shared,
 *  app-wide `curSel` (`lib/currency.ts`) so picking a currency there updates this carousel too; a
 *  logged-out viewer sees a stable per-row symbol from `OPEN_CURS` (see `stableIndex` above). */
function curForRow(rowId: string, loggedIn: boolean, curSel: string): string {
  return loggedIn ? curSel : OPEN_CURS[stableIndex(rowId, OPEN_CURS.length)];
}

/**
 * Docs/COMMS/ADVISOR_TO_PM.md 2026-09-11#8 item B.2 first gave registered viewers a `$` amount
 * (no icon) and logged-out viewers the green "RC" coin glyph (`RcIcon`) + bare number. Ticket
 * 2026-09-13#6 item 2 corrects this with more precise Designer detail, confirmed against the
 * prototype's own `stake: '$' + STAKES[...]`: EVERY row, logged in or out, shows a `$`-prefixed
 * amount, with a small decorative currency-symbol icon next to it — reusing `CurrencyPicker.tsx`'s
 * already-built `CurrencyIcon` component (and its `OPEN_CURS` list) rather than a new sprite. The
 * `cur` prop is computed once per row by the caller via `curForRow` above, so this component
 * itself doesn't need to know `loggedIn`/row-identity at all — it just renders `$value` next to
 * whichever symbol it's told.
 */
function AmountFigure({ value, cur, testId }: { value: string; cur: string; testId?: string }) {
  const numeralStyle = { fontFamily: "'Space Grotesk', Arial, Helvetica, sans-serif", fontSize: '16px', fontWeight: 700, color: '#34D399', whiteSpace: 'nowrap' as const };
  return (
    <>
      <CurrencyIcon sym={cur} size={15} />
      <span data-testid={testId} style={numeralStyle}>{`$${value}`}</span>
    </>
  );
}

export interface GamesCarouselProps {
  /** Cross-game open challenges, keyed by gameId — every hub passes this same shape. */
  challengesByGame: Record<string, OpenChallenge[]>;
  nameByGame: Map<string, string>;
  balance: number;
  onTake(matchId: string): void;
  /** Logged-out JOIN: captures the row's game+stake so the caller's auth wall can resume the
   *  take after sign-in. */
  onTakePublicChallenge?(c: { matchId: string; gameId: string; stake: number }): void;
  /** Also doubles as the registered-vs-not signal for `AmountFigure`'s currency icon
   *  (`curForRow` above, ticket 2026-09-13#6 item 2): logged in → the shared wallet `curSel`;
   *  logged out → a stable per-row `OPEN_CURS` pick. */
  loggedIn: boolean;
  /** Grey out every row's JOIN while the viewer is already mid-commitment (issue #316) — a real
   *  guard, not decorative: `GameHub.tsx` passes `phase === 'in-match' || phase === 'waiting'` so a
   *  player already searching/playing on this exact page can't also take another challenge.
   *  Default false (Home's usage is unaffected — a player is never mid-match on the Home hub). */
  joinDisabled?: boolean;
}

/**
 * The Games-page "Open Games" carousel (issue #305). OPEN GAMES (tab 0) is real, live data;
 * 24H RACE / WEEKLY RACE / RANK (tabs 1-3) are static placeholder UI per Owner decision #1 in
 * `docs/COMMS/from-advisor/games-and-rewards.md`. See the file header for the full design-source
 * transcription and judgment calls.
 */
export function GamesCarousel({ challengesByGame, nameByGame, balance, onTake, onTakePublicChallenge, loggedIn, joinDisabled = false }: GamesCarouselProps) {
  const pool = useOpenChallengesPool(challengesByGame, loggedIn);
  const { items, offset, dur } = useOpenGamesCarousel(pool, nameByGame);
  const liveCount = pool.length; // judgment call #3: real count, not the design's synthetic cycle
  const { resolved } = useTheme();
  const light = resolved === 'light';
  const { curSel } = useCurSel();

  const [tab, setTab] = useState(0);
  const [boardLimit, setBoardLimit] = useState(10);
  const [leftFade, setLeftFade] = useState(0);
  const [rightFade, setRightFade] = useState(1);
  const [notice, setNotice] = useState<string | null>(null);
  const now = useNowTick(1000);

  function pickTab(i: number) {
    setTab(i);
    setBoardLimit(10); // verbatim: TABS[i].pick resets boardLimit (decoded line 1510)
  }

  function onTabScroll(e: UIEvent<HTMLDivElement>) {
    const el = e.currentTarget;
    const max = el.scrollWidth - el.clientWidth;
    setLeftFade(Math.min(1, el.scrollLeft / 24));
    setRightFade(max <= 0 ? 0 : Math.min(1, (max - el.scrollLeft) / 24));
  }

  /** `centerPill()`, transcribed verbatim (ticket 2026-09-13#6 item 1, `Full Spec.html:3492-3501`).
   *  Walks UP from the clicked pill past the non-scrolling inner track div (`tabRailBg`) to find
   *  the actual scrollable ancestor — this rail has one more nesting level than `HomeHub.tsx`'s
   *  `CategoryTabs`/`selectAndCenter` (issue #501), whose pill's own parent IS the scroller, so
   *  that simpler version can't be reused as-is here. */
  function centerPill(pill: HTMLElement) {
    let rail: HTMLElement | null = pill.parentElement;
    while (rail && rail.scrollWidth <= rail.clientWidth + 1) rail = rail.parentElement;
    if (!rail) return;
    const pr = pill.getBoundingClientRect();
    const rr = rail.getBoundingClientRect();
    const target = rail.scrollLeft + (pr.left - rr.left) - (rr.width - pr.width) / 2;
    const max = rail.scrollWidth - rail.clientWidth;
    // Optional call: jsdom (the unit-test DOM) doesn't implement Element.scrollTo at all — every
    // real browser does, same test-environment-only guard as HomeHub.tsx's own selectAndCenter.
    rail.scrollTo?.({ left: Math.max(0, Math.min(max, target)), behavior: 'smooth' });
  }

  function pickAndCenterTab(i: number, pill: HTMLElement) {
    pickTab(i);
    // Matches the prototype's own `setState({tab, boardLimit}, () => requestAnimationFrame(() =>
    // this.centerPill(pill)))` — the rAF gives the browser a frame to commit this render's DOM
    // (background/box-shadow flip) before measuring the pill's own now-current position.
    requestAnimationFrame(() => centerPill(pill));
  }

  function boardMore() {
    setBoardLimit((v) => Math.min(30, v + 10));
  }

  function handleJoinRow(row: CarouselRow) {
    if (joinDisabled) return;
    if (!loggedIn) {
      onTakePublicChallenge?.({ matchId: row.matchId, gameId: row.gameId, stake: row.stake });
      return;
    }
    const msg = insufficientBalanceNotice(row.stake, balance);
    if (msg) {
      setNotice(msg);
      return;
    }
    setNotice(null);
    onTake(row.matchId);
  }

  const isOpenGames = tab === 0;
  const isBoard = tab !== 0;
  const isRace = tab === 1 || tab === 2;
  const isNotRace = !isRace;
  const racePrize = tab === 1 ? '5K' : '25K';
  const title = TABS[tab];
  const raceClock = useMemo(() => computeRaceClock(tab, now), [tab, now]);
  const boardSrc = tab === 1 ? RACE_24H : tab === 2 ? RACE_WEEK : RANKS;
  const boardRows = useMemo(() => buildBoardRows(boardSrc, tab === 3 ? 'rank' : 'race').slice(0, boardLimit), [boardSrc, tab, boardLimit]);
  const boardCountLabel = `Showing ${Math.min(boardLimit, boardSrc.length)} results`;

  return (
    <section data-testid="games-carousel" aria-label="Open games, races and rank">
      <div style={{ margin: '6px 16px 0 16px', padding: '16px 0 14px 0' }}>
        {/* Tab bar (ticket 2026-09-13#6 item 1) — a shared-track rail: an outer `mask-image`-
            bearing scroller wrapping an inner non-scrolling track div (the `tabRailBg` pill
            background), NOT a single flat scroller. Structure/values transcribed verbatim from
            `Full Spec.html:250-256` + `renderVals()`. */}
        <div style={{ position: 'relative', marginTop: '14px' }}>
          <div
            role="tablist"
            aria-label="Games leaderboard tabs"
            onScroll={onTabScroll}
            className="no-scrollbar"
            style={{
              display: 'flex', overflowX: 'auto', WebkitOverflowScrolling: 'touch',
              maskImage: railMask(leftFade, rightFade), WebkitMaskImage: railMask(leftFade, rightFade),
            }}
          >
            <div style={{ display: 'flex', flexWrap: 'nowrap', gap: '9px', width: 'max-content', background: light ? '#DEDEE8' : '#12121A', borderRadius: '999px', padding: '6px 6px 11px 6px' }}>
              {TABS.map((label, i) => (
                <button
                  key={label}
                  type="button"
                  role="tab"
                  aria-selected={i === tab}
                  data-testid={`games-carousel-tab-${i}`}
                  onClick={(e) => pickAndCenterTab(i, e.currentTarget)}
                  className="active:translate-y-[3px]"
                  style={{
                    background: i === tab ? '#8B45F0' : 'var(--rc-surface)',
                    color: i === tab ? '#FFFFFF' : 'var(--rc-text)',
                    boxShadow: i === tab ? 'var(--rc-theme-toggle-active-shadow)' : 'var(--rc-theme-toggle-inactive-shadow)',
                    borderRadius: '999px',
                    padding: '11px 16px',
                    fontFamily: 'Arial, Helvetica, sans-serif',
                    fontSize: '12px',
                    fontWeight: 'bold',
                    letterSpacing: '0.8px',
                    flex: '0 0 auto',
                    whiteSpace: 'nowrap',
                    cursor: 'pointer',
                    border: 'none',
                    transition: 'background 200ms ease, box-shadow 200ms ease, transform 120ms ease',
                  }}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Header row — verbatim (decoded lines 493-538) */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px', marginTop: '16px', padding: '0 2px' }}>
          {isRace && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '14px', minWidth: 0, flex: '1 1 auto' }}>
              <div style={{ position: 'relative', width: '72px', height: '72px', flex: '0 0 72px', borderRadius: '999px', background: '#1A1A2E', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <svg width="72" height="72" viewBox="0 0 72 72" style={{ position: 'absolute', top: 0, left: 0, display: 'block', transform: 'rotate(-90deg)' }} aria-hidden="true">
                  <circle cx="36" cy="36" r="29" fill="none" stroke="#0B0B0B" strokeWidth="5" />
                  <circle
                    cx="36" cy="36" r="29" fill="none" stroke="#8B45F0" strokeWidth="5" strokeLinecap="round"
                    strokeDasharray={RACE_DASH} strokeDashoffset="0" transform="scale(1,-1)"
                    style={{ transformOrigin: '36px 36px', filter: 'drop-shadow(0 0 6px rgba(139,69,240,0.7))' }}
                  />
                </svg>
                <svg width="30" height="30" viewBox="0 0 24 24" style={{ display: 'block', position: 'relative' }} aria-hidden="true">
                  <path d="M7 3.4h10v5.2a5 5 0 0 1-10 0z" fill="#8B45F0" />
                  <path d="M7 4.6H4.6v1.6A3.2 3.2 0 0 0 7.6 9.4" fill="none" stroke="#8B45F0" strokeWidth="1.5" strokeLinecap="round" />
                  <path d="M17 4.6h2.4v1.6a3.2 3.2 0 0 1-3 3.2" fill="none" stroke="#8B45F0" strokeWidth="1.5" strokeLinecap="round" />
                  <path d="M12 13.6v3.2" stroke="#8B45F0" strokeWidth="1.9" strokeLinecap="round" />
                  <path d="M8.2 20.6h7.6v-1.2a1.6 1.6 0 0 0-1.6-1.6h-4.4a1.6 1.6 0 0 0-1.6 1.6z" fill="#8B45F0" />
                </svg>
              </div>
              <div style={{ minWidth: 0, flex: '1 1 auto' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <RcIcon size={20} />
                  <span style={{ fontFamily: 'Arial, Helvetica, sans-serif', fontSize: '22px', fontWeight: 'bold', letterSpacing: '0.4px', color: '#FFFFFF' }}>{racePrize}</span>
                  <span style={{ fontFamily: 'Arial, Helvetica, sans-serif', fontSize: '22px', fontWeight: 'bold', letterSpacing: '0.4px', color: '#FFFFFF', whiteSpace: 'nowrap' }}>{title}</span>
                </div>
                <div style={{ marginTop: '6px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px' }}>
                  <span style={{ fontFamily: 'Arial, Helvetica, sans-serif', fontSize: '11px', fontWeight: 'bold', letterSpacing: '1px', color: '#FFFFFF', whiteSpace: 'nowrap' }}>TIME LEFT:</span>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                    {raceClock.map((c) => (
                      <div key={c.u} style={{ minWidth: '30px', boxSizing: 'border-box', background: '#1A1A2E', borderRadius: '7px', padding: '4px 5px 4px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '1px' }}>
                        <span style={{ fontFamily: "'Space Grotesk', Arial, Helvetica, sans-serif", fontSize: '14px', lineHeight: '14px', fontWeight: 700, color: '#34D399' }}>{c.v}</span>
                        <span style={{ fontFamily: 'Arial, Helvetica, sans-serif', fontSize: '8px', lineHeight: '8px', fontWeight: 'bold', letterSpacing: '0.6px', color: '#34D399' }}>{c.u}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          )}
          {isNotRace && (
            <span style={{ fontFamily: 'Arial, Helvetica, sans-serif', fontSize: '19px', fontWeight: 'bold', letterSpacing: '0.6px', color: '#FFFFFF' }}>{title}</span>
          )}
          {isOpenGames && (
            <div data-testid="games-carousel-live" style={{ display: 'flex', alignItems: 'center', gap: '7px', background: '#1A1A2E', borderRadius: '999px', padding: '6px 13px', flex: '0 0 auto', whiteSpace: 'nowrap' }}>
              <span aria-hidden="true" className="animate-pulse" style={{ width: '7px', height: '7px', borderRadius: '999px', background: '#34D399', display: 'block', flex: '0 0 7px' }} />
              <span style={{ fontFamily: "'Space Grotesk', Arial, Helvetica, sans-serif", fontSize: '12px', fontWeight: 700, color: '#FFFFFF', whiteSpace: 'nowrap' }}>{liveCount} LIVE</span>
            </div>
          )}
        </div>

        {/* OPEN GAMES — real, live rolling list (decoded lines 540-564) */}
        {isOpenGames && (
          items.length === 0 ? (
            <div data-testid="games-carousel-empty" style={{ marginTop: '12px', padding: '28px 4px' }}>
              <p style={{ fontFamily: 'Arial, Helvetica, sans-serif', fontSize: '12px', color: '#83838F', textAlign: 'center' }}>
                No open games right now — pick a tile to post one.
              </p>
            </div>
          ) : (
            <div
              style={{
                position: 'relative', marginTop: '12px', height: '758px', overflow: 'hidden',
                WebkitMaskImage: 'linear-gradient(to bottom, #000 0%, #000 92%, rgba(0,0,0,0.35) 97%, rgba(0,0,0,0) 100%)',
                maskImage: 'linear-gradient(to bottom, #000 0%, #000 92%, rgba(0,0,0,0.35) 97%, rgba(0,0,0,0) 100%)',
              }}
            >
              <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', transform: `translateY(${offset}px)`, transition: `transform ${dur} cubic-bezier(0.22,0.61,0.36,1)` }}>
                {items.map((g) => (
                  // Keyed/testid'd by `uid`, not `matchId`: when the real pool has fewer than
                  // VISIBLE (11) open challenges, the same challenge legitimately appears more
                  // than once in the rolling window (`make()` cycles the pool via modulo, exactly
                  // like the design's own POOL wrap-around) — `matchId` alone would collide.
                  // `data-match-id` carries the real challenge id for tests/queries to key off.
                  <div
                    key={g.uid}
                    data-testid={`games-carousel-row-${g.uid}`}
                    data-match-id={g.matchId}
                    style={{ height: '74px', boxSizing: 'border-box', display: 'flex', alignItems: 'center', gap: '11px', background: g.zebra ? '#1A1A2E' : 'transparent', borderRadius: g.zebra ? '26px' : '0px', padding: '0 16px', flex: '0 0 74px' }}
                  >
                    <div style={{ width: '38px', height: '52px', borderRadius: '8px', flex: '0 0 38px', backgroundColor: '#1B1B2E', backgroundImage: TILE_ART[g.gameId] ? `url(${TILE_ART[g.gameId]})` : undefined, backgroundSize: 'cover', backgroundPosition: 'center' }} />
                    <div style={{ flex: '1 1 auto', minWidth: 0 }}>
                      <div data-testid={`games-carousel-game-${g.uid}`} style={{ fontFamily: 'Arial, Helvetica, sans-serif', fontSize: '14px', fontWeight: 'bold', letterSpacing: '0.4px', color: '#F2F2F6', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {g.gameName}
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '4px', marginTop: '3px' }}>
                        <TierIcon tier={g.ownerTier} size={14} />
                        <span
                          data-testid={`games-carousel-host-${g.uid}`}
                          style={{ fontFamily: 'Arial, Helvetica, sans-serif', fontSize: '12px', fontWeight: 'bold', letterSpacing: '0.4px', color: '#FFFFFF', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}
                        >
                          {g.host}
                        </span>
                      </div>
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '2px', flex: '0 0 auto' }}>
                      <span style={{ fontFamily: 'Arial, Helvetica, sans-serif', fontSize: '9px', fontWeight: 'bold', letterSpacing: '1.2px', color: '#FFFFFF' }}>STAKE:</span>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
                        <AmountFigure value={g.stake.toLocaleString('en-US')} cur={curForRow(g.matchId, loggedIn, curSel)} testId={`games-carousel-stake-${g.uid}`} />
                      </div>
                    </div>
                    <button
                      type="button"
                      data-testid={`games-carousel-join-${g.uid}`}
                      onClick={() => handleJoinRow(g)}
                      disabled={joinDisabled}
                      // Deliberately uses the display name (🤖-free) here too, not the raw
                      // `ownerName` — see `displayHostName`'s own doc comment for why the ADR-010
                      // disclosure is dropped consistently (visible text AND aria-label), not kept
                      // in one but not the other.
                      aria-label={`Join ${g.host}'s ${g.stake} credit ${g.gameName} game`}
                      style={{ flex: '0 0 auto', background: '#8B45F0', borderRadius: '999px', padding: '11px 16px 11px 17px', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: joinDisabled ? 'not-allowed' : 'pointer', opacity: joinDisabled ? 0.4 : 1, border: 'none' }}
                    >
                      <span style={{ fontFamily: 'Arial, Helvetica, sans-serif', fontSize: '13px', lineHeight: '13px', fontWeight: 'bold', letterSpacing: '0.8px', color: '#FFFFFF', display: 'block' }}>JOIN</span>
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )
        )}

        {/* 24H RACE / WEEKLY RACE / RANK — static placeholder board (decoded lines 566-611) */}
        {isBoard && (
          <div style={{ position: 'relative', marginTop: '12px' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
              {boardRows.map((b) => (
                <div
                  key={b.key}
                  data-testid={`games-carousel-board-row-${b.key}`}
                  style={{ height: '74px', boxSizing: 'border-box', display: 'flex', alignItems: 'center', gap: '11px', background: b.bg, borderRadius: b.radius, padding: '0 16px', flex: '0 0 74px' }}
                >
                  {b.showPlaceNum && (
                    <span style={{ fontFamily: "'Space Grotesk', Arial, Helvetica, sans-serif", fontSize: '16px', fontWeight: 700, color: '#8B45F0', minWidth: '16px', textAlign: 'center', flex: '0 0 auto' }}>
                      {b.placeNum}
                    </span>
                  )}
                  <div style={{ width: '38px', height: '52px', flex: '0 0 38px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <Avatar username={b.username} size={38} />
                  </div>
                  <div style={{ flex: '1 1 auto', minWidth: 0 }}>
                    <div style={{ fontSize: '14px', fontWeight: 700, letterSpacing: '0.2px', color: '#F2F2F6', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{b.name}</div>
                    <div style={{ marginTop: '3px', fontSize: '12px', color: '#FFFFFF', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{b.sub}</div>
                  </div>
                  {b.showValue && (
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '2px', flex: '0 0 auto' }}>
                      <span style={{ fontFamily: 'Arial, Helvetica, sans-serif', fontSize: '9px', fontWeight: 'bold', letterSpacing: '1.2px', color: '#FFFFFF' }}>{b.label}</span>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
                        <AmountFigure value={b.value} cur={curForRow(b.key, loggedIn, curSel)} />
                      </div>
                    </div>
                  )}
                  {b.showPrize && (
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '2px', flex: '0 0 auto' }}>
                      <span style={{ fontFamily: 'Arial, Helvetica, sans-serif', fontSize: '9px', fontWeight: 'bold', letterSpacing: '1.2px', color: '#FFFFFF' }}>PRIZE</span>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
                        <AmountFigure value={b.pill} cur={curForRow(b.key, loggedIn, curSel)} />
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
            <div style={{ marginTop: '14px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', padding: '0 4px' }}>
              <span style={{ fontFamily: 'Arial, Helvetica, sans-serif', fontSize: '11px', color: '#FFFFFF', whiteSpace: 'nowrap' }}>{boardCountLabel}</span>
              <button
                type="button"
                data-testid="games-carousel-board-more"
                onClick={boardMore}
                disabled={boardLimit >= 30}
                style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#1A1A2E', borderRadius: '999px', padding: '8px 14px', flex: '0 0 auto', opacity: boardLimit < 30 ? 1 : 0.4, cursor: boardLimit < 30 ? 'pointer' : 'default', transition: 'opacity 200ms ease', border: 'none' }}
              >
                <span style={{ fontFamily: 'Arial, Helvetica, sans-serif', fontSize: '10px', fontWeight: 'bold', letterSpacing: '0.8px', color: '#FFFFFF' }}>VIEW MORE</span>
              </button>
            </div>
          </div>
        )}
      </div>

      {notice && (
        <div role="alert" data-testid="games-carousel-notice" style={{ margin: '8px 16px 0 16px', borderRadius: '10px', border: '1px solid rgba(224,85,108,0.4)', background: 'rgba(224,85,108,0.1)', padding: '8px 12px', fontSize: '12px', fontWeight: 500, color: '#e0556c' }}>
          {notice}
        </div>
      )}
    </section>
  );
}
