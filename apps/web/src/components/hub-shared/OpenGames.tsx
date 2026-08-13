import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import type { OpenChallenge, PublicOpenChallenge } from '@rapidclash/shared';
import { api } from '../../api.js';
import { formatCredits } from '../../format.js';
import { TILE_ART, titleCase } from './tiles.js';

/** How often the logged-out ticker re-polls the public snapshot so the feed visibly moves.
 *  Exported for reuse by the Games-page carousel (issue #305), which polls the same public
 *  snapshot on the same cadence when logged out — one interval constant, not two guesses. */
export const PUBLIC_POLL_MS = 4_000;

/**
 * Owner-confirmed visible-row count (PM_TO_ADVISOR 2026-08-05#1 / issue #259): the ticker window
 * always shows exactly this many rows. Row height is tuned to comfortably fit the icon/name/stake/
 * JOIN layout within a 320px window (320 / 5 = 64).
 */
const TICKER_VISIBLE_ROWS = 5;
const TICKER_ROW_HEIGHT_PX = 64;
const TICKER_WINDOW_HEIGHT_PX = TICKER_VISIBLE_ROWS * TICKER_ROW_HEIGHT_PX;

/** Static hold between steps (issue #259 spec). */
const TICKER_HOLD_MS = 800;

/**
 * Step duration — derived from the OLD continuous marquee (`rc-ticker-scroll`, index.css: a fixed
 * 22s per full loop) rather than picked as an arbitrary new number, per issue #259. The old
 * animation traveled one full copy of the row list per 22s *regardless of row count*, so the
 * time-per-row-height at the boundary row count that used to trigger it (one row above the old
 * 5-row threshold, i.e. 6) is `22s / 6 rows` — the actual row height cancels out of that ratio, so
 * it doesn't matter that the old rows weren't a fixed height while the new ones are.
 */
const OLD_MARQUEE_LOOP_MS = 22_000;
const OLD_MARQUEE_REFERENCE_ROWS = TICKER_VISIBLE_ROWS + 1;
const TICKER_STEP_MS = Math.round(OLD_MARQUEE_LOOP_MS / OLD_MARQUEE_REFERENCE_ROWS);

/** One feed row — shared by the signed-in (WS) and logged-out (public) tickers, and by the
 *  Games-page carousel (issue #305), which reuses this exact shape rather than inventing a
 *  second one. */
export type FeedRow = { gameId: string; c: OpenChallenge };

/** Flattens the per-game WS feed into one oldest-first row list — the exact merge the signed-in
 *  ticker has always done, pulled out so the Games-page carousel's OPEN GAMES tab can reuse it
 *  instead of re-deriving its own (issue #305: "reuse the existing feed, don't build a new path"). */
export function mergeChallengesByGame(challengesByGame: Record<string, OpenChallenge[]>): FeedRow[] {
  const out: FeedRow[] = [];
  for (const [gameId, list] of Object.entries(challengesByGame)) for (const c of list) out.push({ gameId, c });
  return out.sort((a, b) => a.c.openedAt - b.c.openedAt);
}

/** The one balance-affordability check every JOIN action runs before taking a challenge — pulled
 *  out of the signed-in ticker's `handleJoin` so the Games-page carousel (issue #305) reuses the
 *  exact same rule/copy instead of reinventing it. Returns the notice text to show, or `null` if
 *  the stake is covered. */
export function insufficientBalanceNotice(stake: number, balance: number): string | null {
  if (balance >= stake) return null;
  return `Not enough credits to join — needs ${formatCredits(stake)}, you have ${formatCredits(balance)}.`;
}

function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(
    () => typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches,
  );
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const onChange = () => setReduced(mq.matches);
    mq.addEventListener?.('change', onChange);
    return () => mq.removeEventListener?.('change', onChange);
  }, []);
  return reduced;
}

/** One row — a real, fully interactive row keyed by `matchId` (its own JOIN closes over its own
 *  challenge). No panel divider (Part 1); flat on the page/zebra backdrop behind it. */
function TickerRow({ gameId, c, nameByGame, onJoin, joinDisabled = false }: {
  gameId: string;
  c: OpenChallenge;
  nameByGame: Map<string, string>;
  onJoin(): void;
  joinDisabled?: boolean;
}) {
  const art = TILE_ART[gameId];
  const gameName = nameByGame.get(gameId) ?? titleCase(gameId);
  return (
    <div data-testid={`home-row-${c.matchId}`} className="relative flex h-16 items-center gap-3 px-6">
      <div className="h-12 w-10 shrink-0 overflow-hidden rounded-lg bg-background">
        {art && <img src={art} alt="" aria-hidden="true" className="h-full w-full object-cover" />}
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-[13px] font-bold text-foreground" data-testid={`home-row-game-${c.matchId}`}>{gameName}</p>
        <p className="mt-0.5 truncate text-[11.5px] text-muted-foreground">@{c.ownerName}</p>
      </div>
      <span className="mr-2.5 shrink-0 text-[13px] font-extrabold tabular-nums text-success" data-testid={`home-stake-${c.matchId}`}>
        {formatCredits(c.stake)}
      </span>
      <button
        type="button"
        onClick={onJoin}
        disabled={joinDisabled}
        data-testid={`home-join-${c.matchId}`}
        aria-label={`Join ${c.ownerName}'s ${c.stake} credit ${gameName} game`}
        className="shrink-0 rounded-full bg-brand px-3.5 py-2 text-xs font-extrabold uppercase tracking-wide text-white transition-colors hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-40"
      >
        Join
      </button>
    </div>
  );
}

/**
 * Zebra backdrop (Part 2) — a STATIC set of `TICKER_VISIBLE_ROWS` fixed slots, flush against each
 * other, painted once and never re-rendered or moved. Even slots (0, 2, 4 from the top) get the
 * elevated-surface pill (`bg-surface` — the same `--rc-surface` / #1a1a2e token as the rest of the
 * UI's elevated panels, not a new hardcoded hex); odd slots are transparent. Because this backdrop
 * never changes, the zebra pattern trivially "re-resolves correctly" after every step — there is
 * nothing to resolve; only the foreground row content moves over it.
 */
function ZebraBackdrop() {
  return (
    <div aria-hidden="true" data-testid="home-ticker-zebra" className="pointer-events-none absolute inset-0 flex flex-col">
      {Array.from({ length: TICKER_VISIBLE_ROWS }, (_, i) => (
        <div key={i} className={i % 2 === 0 ? 'flex-1 rounded-full bg-surface' : 'flex-1'} />
      ))}
    </div>
  );
}

/**
 * The shift-register stepping state machine (Part 3). Owns exactly which rows are "visible" and,
 * during a step, which one is "incoming" + the wrapper's slide phase. `items` is the live,
 * always-current feed from the caller — but it is only ever *read* (via `itemsRef`) at a hold
 * boundary (the top of `startStep`), never while a slide is in progress, per the issue's live-set
 * reconciliation rule: adds/removes apply at the next hold, not mid-slide.
 */
function useSteppedTicker(items: FeedRow[], reducedMotion: boolean) {
  const itemsRef = useRef(items);
  itemsRef.current = items;

  const shouldAnimate = !reducedMotion && items.length > TICKER_VISIBLE_ROWS;

  const [visible, setVisibleState] = useState<FeedRow[]>(() => items.slice(0, TICKER_VISIBLE_ROWS));
  const visibleRef = useRef(visible);
  function setVisible(next: FeedRow[]) {
    visibleRef.current = next;
    setVisibleState(next);
  }

  const [incoming, setIncoming] = useState<FeedRow | null>(null);
  const [phase, setPhase] = useState<'start' | 'moving'>('start');
  const lastIntroducedIdRef = useRef<string | null>(null);

  // Static / small-list / reduced-motion path: no animation running at all, so there is nothing to
  // protect from a live update — just mirror the feed directly (issue #259: "≤5 rows → no
  // animation"; "prefers-reduced-motion → static snapshot").
  useEffect(() => {
    if (shouldAnimate) return;
    setIncoming(null);
    setPhase('start');
    setVisible(items.slice(0, TICKER_VISIBLE_ROWS));
    // setVisible is a stable local closure (state setter + ref write); items/shouldAnimate are the
    // only real reactive inputs.
  }, [items, shouldAnimate]);

  // The stepper loop. Re-armed only when `shouldAnimate` flips — never restarted by a mere `items`
  // update, which is exactly what keeps reconciliation confined to hold boundaries.
  useEffect(() => {
    if (!shouldAnimate) return;
    let cancelled = false;
    const timers: Array<ReturnType<typeof setTimeout>> = [];
    let raf: number | null = null;

    function startStep() {
      if (cancelled) return;
      const pool = itemsRef.current; // the one and only reconciliation read point

      if (pool.length <= TICKER_VISIBLE_ROWS) {
        // Live set shrank to/under the static threshold at a safe boundary — stop stepping. The
        // caller's `shouldAnimate` will flip false on its next render and the effect above takes
        // over mirroring `items` directly.
        setVisible(pool.slice(0, TICKER_VISIBLE_ROWS));
        setIncoming(null);
        return;
      }

      // Drop any now-taken/closed/expired rows, then backfill any resulting gap straight from the
      // pool so `visible` is always exactly TICKER_VISIBLE_ROWS long entering the slide.
      const poolIds = new Set(pool.map((r) => r.c.matchId));
      const nextVisible = visibleRef.current.filter((r) => poolIds.has(r.c.matchId));
      const visibleIds = new Set(nextVisible.map((r) => r.c.matchId));
      for (const row of pool) {
        if (nextVisible.length >= TICKER_VISIBLE_ROWS) break;
        if (!visibleIds.has(row.c.matchId)) {
          nextVisible.push(row);
          visibleIds.add(row.c.matchId);
        }
      }
      if (nextVisible.length !== visibleRef.current.length || nextVisible.some((r, i) => r !== visibleRef.current[i])) {
        setVisible(nextVisible);
      }

      // Next `incoming`: round-robin through the pool's feed order (oldest-first), continuing just
      // after whichever row was introduced last and wrapping around — an endless loop through every
      // open challenge, mirroring the old marquee's loop, just discretized into steps.
      const startIdx = lastIntroducedIdRef.current ? pool.findIndex((r) => r.c.matchId === lastIntroducedIdRef.current) : -1;
      let candidate: FeedRow | undefined;
      for (let step = 1; step <= pool.length; step++) {
        const row = pool[(startIdx + step + pool.length) % pool.length];
        if (!visibleIds.has(row.c.matchId)) {
          candidate = row;
          break;
        }
      }
      if (!candidate) {
        // Nothing eligible this round (shouldn't happen once pool.length > TICKER_VISIBLE_ROWS) —
        // just hold and re-check next boundary rather than getting stuck.
        timers.push(setTimeout(startStep, TICKER_HOLD_MS));
        return;
      }

      const introduced = candidate;
      // Start the 6-row wrapper at translateY(-rowHeight): visually identical to the current
      // static frame (incoming sits just above the window, the 5 visible rows are exactly where
      // they were).
      setIncoming(introduced);
      setPhase('start');
      raf = requestAnimationFrame(() => {
        if (cancelled) return;
        // Next frame: animate to translateY(0) — incoming slides into slot 0, everything else
        // shifts down one, the previous bottom row slides into the clipped region.
        setPhase('moving');
        timers.push(
          setTimeout(() => {
            if (cancelled) return;
            lastIntroducedIdRef.current = introduced.c.matchId;
            // Commit: drop the old bottom row, reset the wrapper to translateY(0) with no
            // transition (the re-render below swaps back to the plain 5-row static list, so there
            // is no transform to snap back from — no visible jump).
            setVisible([introduced, ...nextVisible.slice(0, TICKER_VISIBLE_ROWS - 1)]);
            setIncoming(null);
            setPhase('start');
            timers.push(setTimeout(startStep, TICKER_HOLD_MS));
          }, TICKER_STEP_MS),
        );
      });
    }

    timers.push(setTimeout(startStep, TICKER_HOLD_MS));
    return () => {
      cancelled = true;
      timers.forEach(clearTimeout);
      if (raf !== null) cancelAnimationFrame(raf);
    };
    // Intentionally re-armed only on `shouldAnimate` transitions; the loop reads live state via
    // refs (itemsRef/visibleRef/lastIntroducedIdRef), not via this dependency list.
  }, [shouldAnimate]);

  return { visible, incoming, phase };
}

/** Renders the row content over the static zebra backdrop: either the plain 5-row static list, or
 *  (mid-step) the 6-row wrapper transformed via `translateY` — the wrapper moves, the rows
 *  themselves never get recycled/swapped, so a tap always lands on the row's own handler. */
function TickerRows({ items, renderRow }: { items: FeedRow[]; renderRow: (row: FeedRow) => ReactNode }) {
  const reducedMotion = usePrefersReducedMotion();
  const { visible, incoming, phase } = useSteppedTicker(items, reducedMotion);

  if (!incoming) {
    return <div className="relative">{visible.map((row) => renderRow(row))}</div>;
  }

  const style: CSSProperties = {
    transform: `translateY(${phase === 'start' ? -TICKER_ROW_HEIGHT_PX : 0}px)`,
    transition: phase === 'moving' ? `transform ${TICKER_STEP_MS}ms linear` : 'none',
  };
  return (
    <div className="relative" style={style}>
      {[incoming, ...visible].map((row) => renderRow(row))}
    </div>
  );
}

/** The ticker window — fixed height (`TICKER_VISIBLE_ROWS` × row height), clipped, flat on the page
 *  background (Part 1: no panel bg/shadow/rounded). Height never changes with row count or
 *  animation state, so nothing outside the list shifts. */
function TickerBody({ items, renderRow }: { items: FeedRow[]; renderRow: (row: FeedRow) => ReactNode }) {
  return (
    <div data-testid="home-ticker-body" className="relative overflow-hidden" style={{ height: TICKER_WINDOW_HEIGHT_PX }}>
      <ZebraBackdrop />
      <TickerRows items={items} renderRow={renderRow} />
    </div>
  );
}

function TickerHeader() {
  return (
    <div className="mb-3 flex items-center gap-2 px-4">
      <h2 className="text-sm font-extrabold uppercase leading-none tracking-[0.03em]">Open Games</h2>
      <span className="ml-1 flex items-center gap-1.5 text-[11px] font-bold uppercase leading-none -translate-y-[3px] text-success">
        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-success" /> Live
      </span>
    </div>
  );
}

function EmptyTicker({ text }: { text: string }) {
  return (
    <div data-testid="home-ticker-empty" className="px-4 py-6">
      <p className="text-center text-xs text-muted-foreground">{text}</p>
    </div>
  );
}

/**
 * Signed-in cross-game Open Games ticker — the live WS aggregate (every game's real feed,
 * keyed by gameId), oldest-first, stepped top-down auto-scroll above 5 rows. Shared by the Home hub
 * and every Game hub. A JOIN takes the owner's stake; on a non-matching game the server's
 * match.start routes to that game's hub. `joinDisabled` greys JOIN while the viewer is
 * mid-commitment.
 */
export function OpenGamesTicker({
  challengesByGame, nameByGame, balance, onTake, joinDisabled = false, emptyText = 'No open games right now — pick a tile to post one.',
}: {
  challengesByGame: Record<string, OpenChallenge[]>;
  nameByGame: Map<string, string>;
  balance: number;
  onTake(matchId: string): void;
  joinDisabled?: boolean;
  emptyText?: string;
}) {
  const [notice, setNotice] = useState<string | null>(null);
  const rows = useMemo(() => mergeChallengesByGame(challengesByGame), [challengesByGame]);

  function handleJoin(c: OpenChallenge) {
    const msg = insufficientBalanceNotice(c.stake, balance);
    if (msg) {
      setNotice(msg);
      return;
    }
    setNotice(null);
    onTake(c.matchId);
  }

  return (
    <section data-testid="home-ticker" aria-label="Open games">
      <TickerHeader />
      {notice && (
        <div role="alert" data-testid="home-ticker-notice" className="mx-4 mb-2 rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs font-medium text-destructive">
          {notice}
        </div>
      )}
      <div className="px-4">
        {rows.length === 0 ? (
          <EmptyTicker text={emptyText} />
        ) : (
          <TickerBody
            items={rows}
            renderRow={({ gameId, c }) => (
              <TickerRow key={c.matchId} gameId={gameId} c={c} nameByGame={nameByGame} joinDisabled={joinDisabled} onJoin={() => handleJoin(c)} />
            )}
          />
        )}
        {joinDisabled && rows.length > 0 && (
          <p className="mt-2 text-center text-[11px] text-muted-foreground">One match at a time — finish or cancel your current bet to join another.</p>
        )}
      </div>
    </section>
  );
}

/**
 * Logged-out cross-game ticker — the SAME feed from the public snapshot (GET /open-challenges),
 * polled so it visibly moves. Real data only — never fabricated. A JOIN hits the auth wall,
 * which resumes the take after sign-in (no anonymous play).
 */
export function PublicOpenGamesTicker({
  nameByGame, onJoin, onSignIn,
}: {
  nameByGame: Map<string, string>;
  onJoin(c: { matchId: string; gameId: string; stake: number }): void;
  onSignIn(): void;
}) {
  const [rows, setRows] = useState<PublicOpenChallenge[]>([]);
  useEffect(() => {
    let alive = true;
    const load = () => api.openChallenges().then((r) => { if (alive && Array.isArray(r)) setRows(r); }).catch(() => {});
    load();
    const id = setInterval(load, PUBLIC_POLL_MS);
    return () => { alive = false; clearInterval(id); };
  }, []);

  const sorted = useMemo(() => [...rows].sort((a, b) => a.openedAt - b.openedAt), [rows]);

  return (
    <section data-testid="home-ticker" aria-label="Open games">
      <TickerHeader />
      <div className="px-4">
        {sorted.length === 0 ? (
          <EmptyTicker text="No open games right now — check back in a moment." />
        ) : (
          <TickerBody
            items={sorted.map((c) => ({ gameId: c.gameId, c }))}
            renderRow={({ gameId, c }) => (
              <TickerRow key={c.matchId} gameId={gameId} c={c} nameByGame={nameByGame} onJoin={() => onJoin({ matchId: c.matchId, gameId, stake: c.stake })} />
            )}
          />
        )}
        <button
          type="button"
          onClick={onSignIn}
          data-testid="home-ticker-signin"
          className="mt-3 w-full rounded-full bg-brand px-5 py-2.5 text-xs font-bold text-white transition-colors hover:brightness-105"
        >
          Sign in to play
        </button>
      </div>
    </section>
  );
}
