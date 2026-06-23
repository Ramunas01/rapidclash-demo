import { useEffect, useMemo, useState, type ReactNode } from 'react';
import type { OpenChallenge, PublicOpenChallenge } from '@rapidclash/shared';
import { api } from '../../api.js';
import { formatCredits } from '../../format.js';
import { TILE_ART, titleCase } from './tiles.js';

/** How often the logged-out ticker re-polls the public snapshot so the feed visibly moves. */
const PUBLIC_POLL_MS = 4_000;
/** Above this many rows, the list auto-scrolls (rows duplicated for a seamless loop). */
const SCROLL_THRESHOLD = 5;

/** One feed row — shared by the signed-in (WS) and logged-out (public) tickers. `clone` drops
 *  the test ids so the duplicated (scrolling) copy never collides with the real one. */
function TickerRow({ gameId, c, nameByGame, onJoin, joinDisabled = false, clone = false }: {
  gameId: string;
  c: OpenChallenge;
  nameByGame: Map<string, string>;
  onJoin(): void;
  joinDisabled?: boolean;
  clone?: boolean;
}) {
  const art = TILE_ART[gameId];
  const gameName = nameByGame.get(gameId) ?? titleCase(gameId);
  return (
    <div
      data-testid={clone ? undefined : `home-row-${c.matchId}`}
      className="flex items-center gap-3 border-t border-[#1e1e1e] px-3.5 py-2.5 first:border-t-0"
    >
      <div className="h-[54px] w-10 shrink-0 overflow-hidden rounded-lg bg-background">
        {art && <img src={art} alt="" aria-hidden="true" className="h-full w-full object-cover" />}
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-[13px] font-bold text-foreground" data-testid={clone ? undefined : `home-row-game-${c.matchId}`}>{gameName}</p>
        <p className="mt-0.5 truncate text-[11.5px] text-muted-foreground">@{c.ownerName}</p>
      </div>
      <span className="mr-2.5 shrink-0 text-[13px] font-extrabold tabular-nums text-success" data-testid={clone ? undefined : `home-stake-${c.matchId}`}>
        {formatCredits(c.stake)}
      </span>
      <button
        type="button"
        onClick={clone ? undefined : onJoin}
        disabled={joinDisabled}
        tabIndex={clone ? -1 : undefined}
        aria-hidden={clone || undefined}
        data-testid={clone ? undefined : `home-join-${c.matchId}`}
        aria-label={`Join ${c.ownerName}'s ${c.stake} credit ${gameName} game`}
        className="shrink-0 rounded-full bg-brand px-3.5 py-2 text-xs font-extrabold uppercase tracking-wide text-white transition-colors hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-40"
      >
        Join
      </button>
    </div>
  );
}

/** The bordered, fixed-height scroll box (the frame's 320px panel). Above SCROLL_THRESHOLD
 *  rows it auto-scrolls; the rows are duplicated (aria-hidden clone) for a seamless loop. */
function TickerBody({ count, rows, clones }: { count: number; rows: ReactNode; clones: ReactNode }) {
  const animate = count > SCROLL_THRESHOLD;
  return (
    <div className="overflow-hidden rounded-[14px] border border-border bg-card" style={{ maxHeight: 320 }}>
      <div className={animate ? 'rc-ticker-anim' : undefined}>
        {rows}
        {animate && <div aria-hidden="true">{clones}</div>}
      </div>
    </div>
  );
}

function TickerHeader() {
  return (
    <div className="mb-3 flex items-center gap-2 px-4">
      <h2 className="text-sm font-extrabold uppercase tracking-[0.03em]">Open Games</h2>
      <span className="ml-1 flex items-center gap-1.5 text-[11px] font-bold uppercase text-success">
        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-success" /> Live
      </span>
    </div>
  );
}

function EmptyTicker({ text }: { text: string }) {
  return (
    <div className="rounded-[14px] border border-border bg-card px-4 py-6">
      <p className="text-center text-xs text-muted-foreground">{text}</p>
    </div>
  );
}

/**
 * Signed-in cross-game Open Games ticker — the live WS aggregate (every game's real feed,
 * keyed by gameId), oldest-first, round-robin auto-scroll. Shared by the Home hub and every
 * Game hub. A JOIN takes the owner's stake; on a non-matching game the server's match.start
 * routes to that game's hub. `joinDisabled` greys JOIN while the viewer is mid-commitment.
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
  const rows = useMemo(() => {
    const out: { gameId: string; c: OpenChallenge }[] = [];
    for (const [gameId, list] of Object.entries(challengesByGame)) for (const c of list) out.push({ gameId, c });
    return out.sort((a, b) => a.c.openedAt - b.c.openedAt);
  }, [challengesByGame]);

  function handleJoin(c: OpenChallenge) {
    if (balance < c.stake) {
      setNotice(`Not enough credits to join — needs ${formatCredits(c.stake)}, you have ${formatCredits(balance)}.`);
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
            count={rows.length}
            rows={rows.map(({ gameId, c }) => <TickerRow key={c.matchId} gameId={gameId} c={c} nameByGame={nameByGame} joinDisabled={joinDisabled} onJoin={() => handleJoin(c)} />)}
            clones={rows.map(({ gameId, c }) => <TickerRow key={`clone-${c.matchId}`} clone gameId={gameId} c={c} nameByGame={nameByGame} onJoin={() => {}} />)}
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
            count={sorted.length}
            rows={sorted.map((c) => <TickerRow key={c.matchId} gameId={c.gameId} c={c} nameByGame={nameByGame} onJoin={() => onJoin({ matchId: c.matchId, gameId: c.gameId, stake: c.stake })} />)}
            clones={sorted.map((c) => <TickerRow key={`clone-${c.matchId}`} clone gameId={c.gameId} c={c} nameByGame={nameByGame} onJoin={() => {}} />)}
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
