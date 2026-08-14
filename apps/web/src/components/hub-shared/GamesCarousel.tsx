import { useEffect, useMemo, useRef, useState, type UIEvent } from 'react';
import type { OpenChallenge, PublicOpenChallenge } from '@rapidclash/shared';
import { api } from '../../api.js';
import { TILE_ART, titleCase } from './tiles.js';
import { Avatar } from './Avatar.js';
import { mergeChallengesByGame, insufficientBalanceNotice, PUBLIC_POLL_MS, type FeedRow } from './OpenGames.js';
import { RcIcon } from './RcIcon.js';

/**
 * Games-page "Open Games" carousel (issue #305, `docs/COMMS/from-advisor/games-and-rewards.md`
 * §A). Source: the Designer's export, decoded from `design-ref/games-and-rewards/RapidClash -
 * Games and Rewards.html` (gitignored — a `<script type="__bundler/template">` JSON-escaped
 * blob at line 382; the `Component` class's `componentDidMount`/`tick()`/`make()`/`boardRows()`/
 * `raceClock()` sit around decoded-line 1183-1540, the JSX markup around decoded-line 480-611).
 * Facts transcribed here so they survive the design-ref worktree being gitignored/removed, per
 * `WORKING_AGREEMENT.md`'s gitignored-artifact rule:
 *
 * - Tabs: `TABS = ['OPEN GAMES', '24H RACE', 'WEEKLY RACE', 'RANK']`, `state.tab` picks one;
 *   picking a tab also resets `boardLimit` to 10.
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
 * 5. **Stake/prize/XP numerals show a plain numeral beside a green "RC" coin glyph** (`RcIcon`,
 *    now the shared `hub-shared/RcIcon.tsx` component — issue #324 generalized this component's
 *    original transcribed glyph into the sitewide credits display, so every visible credits
 *    figure in the app now reads this way, not just this carousel).
 * 6. **Interactive elements are real `<button>`s**, not the design's plain `<div>`/`<span>` with
 *    `onClick` — matching this codebase's existing precedent for every other design-transcribed
 *    interactive control (`HomeHub.tsx`'s `CategoryTabs`/`GridControls`, etc.). Unlike the
 *    Bring-a-Rival banner's marketing CTA (deliberately a non-focusable div, Owner-confirmed
 *    issue #301), JOIN/tab-pick/VIEW MORE here perform real stake-taking/navigation actions, so
 *    keyboard/AT reachability follows the app's functional-control precedent, not the marketing
 *    one.
 */

const TABS = ['OPEN GAMES', '24H RACE', 'WEEKLY RACE', 'RANK'];

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
 *  (decoded lines 1305-1317), with real data substituted for `POOL`/`STAKES` per issue #305. */
interface CarouselRow {
  uid: number;
  matchId: string;
  gameId: string;
  gameName: string;
  host: string;
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
      host: `@${row.c.ownerName}`,
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

export interface GamesCarouselProps {
  /** Cross-game open challenges, keyed by gameId — every hub passes this same shape. */
  challengesByGame: Record<string, OpenChallenge[]>;
  nameByGame: Map<string, string>;
  balance: number;
  onTake(matchId: string): void;
  /** Logged-out JOIN: captures the row's game+stake so the caller's auth wall can resume the
   *  take after sign-in. */
  onTakePublicChallenge?(c: { matchId: string; gameId: string; stake: number }): void;
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
        {/* Tab bar — verbatim (decoded lines 483-491) */}
        <div style={{ position: 'relative', marginTop: '14px' }}>
          <div
            role="tablist"
            aria-label="Games leaderboard tabs"
            onScroll={onTabScroll}
            className="no-scrollbar"
            style={{ display: 'flex', flexWrap: 'nowrap', gap: '9px', overflowX: 'auto', padding: '0 2px' }}
          >
            {TABS.map((label, i) => (
              <button
                key={label}
                type="button"
                role="tab"
                aria-selected={i === tab}
                data-testid={`games-carousel-tab-${i}`}
                onClick={() => pickTab(i)}
                style={{
                  background: i === tab ? '#8B45F0' : '#1A1A2E',
                  borderRadius: '999px',
                  padding: '11px 16px',
                  fontFamily: 'Arial, Helvetica, sans-serif',
                  fontSize: '12px',
                  fontWeight: 'bold',
                  letterSpacing: '0.8px',
                  color: '#FFFFFF',
                  flex: '0 0 auto',
                  whiteSpace: 'nowrap',
                  cursor: 'pointer',
                  border: 'none',
                }}
              >
                {label}
              </button>
            ))}
          </div>
          <div
            aria-hidden="true"
            style={{
              position: 'absolute', top: '-1px', bottom: '-1px', left: '-2px', width: '38px',
              pointerEvents: 'none', opacity: leftFade, transition: 'opacity 180ms ease',
              background: 'linear-gradient(to right, rgba(11,11,11,1) 0%, rgba(11,11,11,1) 12%, rgba(11,11,11,0.7) 58%, rgba(11,11,11,0) 100%)',
            }}
          />
          <div
            aria-hidden="true"
            style={{
              position: 'absolute', top: '-1px', bottom: '-1px', right: '-2px', width: '54px',
              pointerEvents: 'none', opacity: rightFade, transition: 'opacity 180ms ease',
              background: 'linear-gradient(to left, rgba(11,11,11,1) 0%, rgba(11,11,11,1) 12%, rgba(11,11,11,0.7) 58%, rgba(11,11,11,0) 100%)',
            }}
          />
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
                      <div style={{ fontFamily: 'Arial, Helvetica, sans-serif', marginTop: '3px', fontSize: '12px', fontWeight: 'bold', letterSpacing: '0.4px', color: '#FFFFFF', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {g.host}
                      </div>
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '2px', flex: '0 0 auto' }}>
                      <span style={{ fontFamily: 'Arial, Helvetica, sans-serif', fontSize: '9px', fontWeight: 'bold', letterSpacing: '1.2px', color: '#FFFFFF' }}>STAKE:</span>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
                        <RcIcon size={15} />
                        <span data-testid={`games-carousel-stake-${g.uid}`} style={{ fontFamily: "'Space Grotesk', Arial, Helvetica, sans-serif", fontSize: '16px', fontWeight: 700, color: '#34D399' }}>
                          {g.stake.toLocaleString('en-US')}
                        </span>
                      </div>
                    </div>
                    <button
                      type="button"
                      data-testid={`games-carousel-join-${g.uid}`}
                      onClick={() => handleJoinRow(g)}
                      disabled={joinDisabled}
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
                        <RcIcon size={15} />
                        <span style={{ fontFamily: "'Space Grotesk', Arial, Helvetica, sans-serif", fontSize: '16px', fontWeight: 700, color: '#34D399' }}>{b.value}</span>
                      </div>
                    </div>
                  )}
                  {b.showPrize && (
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '2px', flex: '0 0 auto' }}>
                      <span style={{ fontFamily: 'Arial, Helvetica, sans-serif', fontSize: '9px', fontWeight: 'bold', letterSpacing: '1.2px', color: '#FFFFFF' }}>PRIZE</span>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
                        <RcIcon size={15} />
                        <span style={{ fontFamily: "'Space Grotesk', Arial, Helvetica, sans-serif", fontSize: '16px', fontWeight: 700, color: '#34D399', whiteSpace: 'nowrap' }}>{b.pill}</span>
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
