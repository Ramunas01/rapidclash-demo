import { useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { Clock, Coins, Swords, Zap } from 'lucide-react';
import type { GameMeta, OpenChallenge, PublicOpenChallenge, LeaderboardEntry } from '@rapidclash/shared';
import { api } from '../api.js';
import { formatCredits, formatClock, CREDIT_SYMBOL } from '../format.js';
import { formatStat } from './Leaderboard.js';
import { cn } from '@/lib/utils';
import { HubRibbon } from '../components/hub-chrome/HubRibbon.js';
import { HubToolbar } from '../components/hub-chrome/HubToolbar.js';
import heroBanner from '../assets/banners/banner-players-vs-house.webp';
import rivalBanner from '../assets/banners/banner-Bring-the-rival.png';
import rpsArt from '../assets/games/rps.webp';
import coinflipArt from '../assets/games/coinflip.webp';
import chessArt from '../assets/games/chess.webp';
import blackjackArt from '../assets/games/blackjack.webp';
import minesArt from '../assets/games/mines.webp';
import baccaratArt from '../assets/games/baccarat.webp';
import crashArt from '../assets/games/crash.webp';
import diceArt from '../assets/games/dice.webp';
import hiloArt from '../assets/games/hilo.webp';
import kenoArt from '../assets/games/keno.webp';
import rouletteArt from '../assets/games/roulette.webp';

/** v2 tile art keyed by gameId. (No `limbo` — its export tile baked in "900x" multiplier
 *  framing and was rejected; it falls back to a plain gradient tile below.) */
const TILE_ART: Record<string, string> = {
  rps: rpsArt, coinflip: coinflipArt, chess: chessArt, blackjack: blackjackArt, mines: minesArt,
  baccarat: baccaratArt, crash: crashArt, dice: diceArt, hilo: hiloArt, keno: kenoArt, roulette: rouletteArt,
};

/**
 * Breadth shown to investors: games not (yet) returned by /games render as dimmed
 * "coming soon" tiles with NO play route. These are the house-edge games + Baccarat,
 * owner-committed as deferred PvP-redefinitions (HUB_TRANSITION_ANALYSIS §6).
 */
const COMING_SOON = ['limbo', 'crash', 'keno', 'hilo', 'roulette', 'dice', 'baccarat'];

function titleCase(id: string): string {
  return id.charAt(0).toUpperCase() + id.slice(1);
}

const entrance = (i: number) => ({
  initial: { opacity: 0, y: 16 },
  animate: { opacity: 1, y: 0 },
  transition: { delay: Math.min(i, 8) * 0.04, duration: 0.35 },
});

interface Props {
  token: string;
  balance: number;
  /** Cross-game open challenges, keyed by gameId (App aggregates per-game feeds). */
  challengesByGame: Record<string, OpenChallenge[]>;
  /** Subscribe to every game's challenge feed (App wraps ws.subscribeChallenges). */
  onTrackChallenges(gameIds: string[]): void;
  onUntrackChallenges(): void;
  onTakeChallenge(matchId: string): void;
  /** Logged-out JOIN: the public ticker passes the row's game + stake so the auth wall can capture
   *  a full {action:'join'} intent (matchId may be gone by auth → fall back to that hub, stake armed). */
  onTakePublicChallenge?(c: { matchId: string; gameId: string; stake: number }): void;
  /** Playable tile tap → that game's flow (coinflip→hub, others→stake-entry). */
  onSelectGame(meta: GameMeta): void;
  onOpenWallet(): void;
  /** Logo / Games nav — Home is the landing, so these return here. */
  onHome(): void;
  /** Logged out → no wallet/feed (auth-required); browse stays open, chip is "Sign in". */
  loggedIn?: boolean;
}

/**
 * Home hub — the post-login landing and the Games/Menu target. Composes the promo hero,
 * the data-driven game grid (PvP playable vs house "coming soon"), a CROSS-GAME open-games
 * ticker (client-side aggregate of each game's real feed), a leaderboard-lite, the static
 * "Bring a Rival" banner and a sanitized footer — all on one screen, no route navigation
 * between sections. Presentation only: no hidden match info is shown here. See
 * docs/HUB_TRANSITION.md.
 */
export function HomeHubScreen({
  token, balance, challengesByGame, onTrackChallenges, onUntrackChallenges,
  onTakeChallenge, onTakePublicChallenge, onSelectGame, onOpenWallet, onHome, loggedIn = true,
}: Props) {
  const [games, setGames] = useState<GameMeta[]>([]);
  const [liveBalance, setLiveBalance] = useState(balance);
  useEffect(() => { setLiveBalance(balance); }, [balance]);
  useEffect(() => {
    let alive = true;
    // /games is public; the wallet is auth-only — only fetch it when signed in.
    if (loggedIn) api.wallet(token).then((w) => { if (alive) setLiveBalance(w.balance); }).catch(() => {});
    api.games(token).then((g) => { if (alive && Array.isArray(g)) setGames(g); }).catch(() => {});
    return () => { alive = false; };
  }, [token, loggedIn]);

  // Subscribe to every playable game's challenge feed for the cross-game ticker; the App
  // merges the per-game lists into challengesByGame. Re-runs only when the game set changes.
  // The feed rides the WS (auth) — skip it when logged out (the ticker shows a sign-in teaser).
  const gameKey = games.map((g) => g.id).join(',');
  useEffect(() => {
    if (!loggedIn || games.length === 0) return;
    onTrackChallenges(games.map((g) => g.id));
    return () => onUntrackChallenges();
    // eslint-disable-next-line -- track once per game-set change (callbacks are stable)
  }, [gameKey, loggedIn]);

  const comingSoon = useMemo(() => {
    const playable = new Set(games.map((g) => g.id));
    return COMING_SOON.filter((id) => !playable.has(id));
  }, [games]);

  const nameByGame = useMemo(() => new Map(games.map((g) => [g.id, g.displayName])), [games]);

  return (
    <div className="flex h-[100dvh] flex-col bg-background text-foreground">
      <HubRibbon balance={liveBalance} onLogo={onHome} onWallet={onOpenWallet} loggedIn={loggedIn} />

      <main className="flex-1 overflow-y-auto" data-testid="home-hub">
        <div className="mx-auto flex max-w-md flex-col gap-5 px-4 py-4">
          {/* 1 — Promo hero (static, clean play-money banner). */}
          <section data-testid="home-hero" aria-label="Players vs Players, never the house">
            <img src={heroBanner} alt="RapidClash — Players vs Players, never the house" className="w-full rounded-2xl" />
          </section>

          {/* 2 — Game grid: PvP playable + house "coming soon" (data-driven from /games). */}
          <section data-testid="home-grid" aria-label="Games">
            <div className="mb-3 flex items-center gap-2">
              <Zap className="h-4 w-4 text-brand" />
              <h2 className="text-sm font-bold uppercase tracking-wide text-foreground">Rapid Originals</h2>
              {games.length > 0 && (
                <span className="ml-auto text-xs text-muted-foreground">{games.length + comingSoon.length} games</span>
              )}
            </div>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              {games.map((g, i) => (
                <PlayableTile key={g.id} meta={g} index={i} onSelect={onSelectGame} />
              ))}
              {comingSoon.map((id, i) => (
                <ComingSoonTile key={id} id={id} index={games.length + i} />
              ))}
            </div>
          </section>

          {/* 3 — Open Games ticker — cross-game, real feed only (never fabricated rows).
              Signed in → the live WS aggregate; logged out → a polled public snapshot of the
              same resting challenges (GET /open-challenges) so a visitor sees real movement.
              JOIN still needs auth — the wall fires on the tap and resumes the take. */}
          {loggedIn ? (
            <OpenGamesTicker
              challengesByGame={challengesByGame}
              nameByGame={nameByGame}
              balance={liveBalance}
              onTake={onTakeChallenge}
            />
          ) : (
            <PublicOpenGamesTicker
              nameByGame={nameByGame}
              onJoin={(c) => onTakePublicChallenge?.(c)}
              onSignIn={onOpenWallet}
            />
          )}

          {/* 4 — Leaderboard-lite (reuses Leaderboard's formatStat). */}
          <HomeLeaderboard token={token} gameId="coinflip" />

          {/* 5 — "Bring a Rival" (static banner; the invite-link feature isn't built). */}
          <section data-testid="home-rival" aria-label="Bring a rival">
            <img src={rivalBanner} alt="Bring a rival — challenge a friend" className="w-full rounded-2xl" />
          </section>

          {/* 6 — Footer (sanitized). */}
          <footer data-testid="home-footer" className="border-t border-border pt-4 pb-2 text-center">
            <p className="text-xs font-semibold text-foreground/70">Players vs Players — never the house.</p>
            <p className="mt-1 text-[11px] text-muted-foreground">Play-money demo · credits only, no real-world value.</p>
          </footer>
        </div>
      </main>

      <HubToolbar onGames={onHome} onAccount={onOpenWallet} />
    </div>
  );
}

/** A playable game — data-driven from /games. Tap → onSelect(meta). v2 tile art. */
function PlayableTile({ meta, index, onSelect }: { meta: GameMeta; index: number; onSelect(m: GameMeta): void }) {
  const art = TILE_ART[meta.id];
  return (
    <motion.button
      type="button"
      onClick={() => onSelect(meta)}
      aria-label={`Play ${meta.displayName}`}
      data-testid={`home-tile-${meta.id}`}
      {...entrance(index)}
      className="group relative aspect-[3/4] w-full overflow-hidden rounded-2xl border border-border bg-surface transition-all duration-300 hover:-translate-y-1 hover:border-brand/40 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand"
    >
      <TileArt art={art} name={meta.displayName} />
      <div className="relative flex h-full flex-col justify-between p-2.5 text-white">
        <div className="flex items-start justify-between">
          <span className="text-[7px] font-bold uppercase tracking-widest text-white/50">P2P</span>
          <span className="flex items-center gap-1">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-success" />
            <span className="text-[7px] font-bold uppercase text-success">Live</span>
          </span>
        </div>
        <div className="text-center text-[9px] text-white/70">
          {meta.bet.minStake}–{meta.bet.maxStake}{CREDIT_SYMBOL} · ~{meta.averageDurationSec}s
        </div>
      </div>
    </motion.button>
  );
}

/** Non-interactive breadth tile (no PLAY route) — clearly disabled. */
function ComingSoonTile({ id, index }: { id: string; index: number }) {
  const art = TILE_ART[id];
  return (
    <motion.div
      aria-disabled="true"
      data-testid={`home-coming-soon-${id}`}
      {...entrance(index)}
      className="relative aspect-[3/4] overflow-hidden rounded-2xl border border-border bg-surface opacity-55"
    >
      <TileArt art={art} name={titleCase(id)} grayscale />
      <div className="relative flex h-full flex-col justify-between p-2.5 text-white">
        <span className="self-end rounded-full bg-brand/20 px-1.5 py-0.5 text-[7px] font-bold uppercase tracking-wide text-brand">
          Coming soon
        </span>
        <span className="sr-only">{titleCase(id)} — coming soon</span>
      </div>
    </motion.div>
  );
}

/** Tile backdrop: designed art when present (name baked in), else a gradient + name fallback. */
function TileArt({ art, name, grayscale }: { art?: string; name: string; grayscale?: boolean }) {
  if (art) {
    return (
      <>
        <img
          src={art}
          alt=""
          aria-hidden="true"
          loading="lazy"
          decoding="async"
          className={cn('absolute inset-0 h-full w-full object-cover transition-transform duration-500 group-hover:scale-105', grayscale && 'grayscale')}
        />
        <div className="absolute inset-0 bg-gradient-to-b from-black/50 via-transparent to-black/70" />
      </>
    );
  }
  return (
    <div className="absolute inset-0 flex items-center justify-center bg-gradient-to-br from-brand/30 to-indigo-900/50">
      <span className="px-1 text-center text-sm font-black uppercase tracking-wide text-white/85">{name}</span>
    </div>
  );
}

const URGENT_MS = 10_000;
/** How often the logged-out ticker re-polls the public snapshot so the feed visibly moves. */
const PUBLIC_POLL_MS = 4_000;

/** One feed row — shared by the signed-in (WS) and logged-out (public poll) tickers so they
 *  render identically. `onJoin` decides what a JOIN tap does (take vs the auth wall). */
function TickerRow({ gameId, c, now, nameByGame, onJoin }: {
  gameId: string;
  c: OpenChallenge;
  now: number;
  nameByGame: Map<string, string>;
  onJoin(): void;
}) {
  const remaining = c.expiresAt - now;
  const urgent = remaining <= URGENT_MS;
  const art = TILE_ART[gameId];
  const gameName = nameByGame.get(gameId) ?? titleCase(gameId);
  return (
    <div
      data-testid={`home-row-${c.matchId}`}
      className="flex items-center gap-3 rounded-xl bg-surface p-2.5"
    >
      <div className="h-12 w-9 shrink-0 overflow-hidden rounded-md bg-background">
        {art && <img src={art} alt="" aria-hidden="true" className="h-full w-full object-cover" />}
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold text-foreground" data-testid={`home-row-game-${c.matchId}`}>
          {gameName}
        </p>
        <p className="mt-0.5 truncate text-[11px] text-muted-foreground">@{c.ownerName}</p>
      </div>
      <div className="flex shrink-0 flex-col items-end gap-1">
        <span className="flex items-center gap-1 text-sm font-bold text-brand">
          <Coins className="h-3.5 w-3.5" />
          <span data-testid={`home-stake-${c.matchId}`}>{formatCredits(c.stake)}</span>
        </span>
        <span className={cn('flex items-center gap-1 text-[10px] tabular-nums', urgent ? 'text-destructive' : 'text-muted-foreground')}>
          <Clock className="h-3 w-3" />{formatClock(remaining)}
        </span>
      </div>
      <button
        type="button"
        onClick={onJoin}
        data-testid={`home-join-${c.matchId}`}
        aria-label={`Join ${c.ownerName}'s ${c.stake} credit ${gameName} game`}
        className="shrink-0 rounded-full bg-play px-4 py-2 text-xs font-extrabold uppercase tracking-wide text-background transition-colors hover:brightness-105"
      >
        Join
      </button>
    </div>
  );
}

/** §3 — cross-game Open Games ticker. Flattens every game's REAL feed into one list. */
function OpenGamesTicker({
  challengesByGame, nameByGame, balance, onTake,
}: {
  challengesByGame: Record<string, OpenChallenge[]>;
  nameByGame: Map<string, string>;
  balance: number;
  onTake(matchId: string): void;
}) {
  const [now, setNow] = useState(() => Date.now());
  const [notice, setNotice] = useState<string | null>(null);
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const rows = useMemo(() => {
    const out: { gameId: string; c: OpenChallenge }[] = [];
    for (const [gameId, list] of Object.entries(challengesByGame)) {
      for (const c of list) out.push({ gameId, c });
    }
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
    <section data-testid="home-ticker" aria-label="Open games" className="rounded-2xl border border-border bg-card p-4">
      <div className="mb-3 flex items-center gap-2">
        <Swords className="h-4 w-4 text-brand" />
        <h2 className="text-sm font-bold uppercase tracking-wide text-foreground">Open games</h2>
        {rows.length > 0 && (
          <span className="ml-auto flex items-center gap-1 text-[11px] font-bold uppercase text-success">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-success" /> {rows.length} live
          </span>
        )}
      </div>

      {notice && (
        <div role="alert" data-testid="home-ticker-notice" className="mb-2 rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs font-medium text-destructive">
          {notice}
        </div>
      )}

      {rows.length === 0 ? (
        <p className="py-2 text-center text-xs text-muted-foreground">No open games right now — pick a tile to post one.</p>
      ) : (
        <div className="space-y-2">
          {rows.map(({ gameId, c }) => (
            <TickerRow
              key={c.matchId}
              gameId={gameId}
              c={c}
              now={now}
              nameByGame={nameByGame}
              onJoin={() => handleJoin(c)}
            />
          ))}
        </div>
      )}
    </section>
  );
}

/** §3 (logged out) — the SAME open-games feed, fed by the public snapshot (GET /open-challenges)
 *  instead of the authed WS. Re-polls so a visitor sees real movement (the bot crowd posting /
 *  clearing). Real data only — never fabricated. A JOIN tap (row or the footer button) hits the
 *  auth wall, which captures the intent and resumes the take after sign-in (no anonymous play). */
function PublicOpenGamesTicker({
  nameByGame, onJoin, onSignIn,
}: {
  nameByGame: Map<string, string>;
  onJoin(c: { matchId: string; gameId: string; stake: number }): void;
  onSignIn(): void;
}) {
  const [rows, setRows] = useState<PublicOpenChallenge[]>([]);
  const [now, setNow] = useState(() => Date.now());

  // Poll the public snapshot so the feed visibly moves; no auth, no WS.
  useEffect(() => {
    let alive = true;
    const load = () => api.openChallenges()
      .then((r) => { if (alive && Array.isArray(r)) setRows(r); })
      .catch(() => {});
    load();
    const id = setInterval(load, PUBLIC_POLL_MS);
    return () => { alive = false; clearInterval(id); };
  }, []);
  // Tick the countdown clock independently of the poll.
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const sorted = useMemo(() => [...rows].sort((a, b) => a.openedAt - b.openedAt), [rows]);

  return (
    <section data-testid="home-ticker" aria-label="Open games" className="rounded-2xl border border-border bg-card p-4">
      <div className="mb-3 flex items-center gap-2">
        <Swords className="h-4 w-4 text-brand" />
        <h2 className="text-sm font-bold uppercase tracking-wide text-foreground">Open games</h2>
        {sorted.length > 0 && (
          <span className="ml-auto flex items-center gap-1 text-[11px] font-bold uppercase text-success">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-success" /> {sorted.length} live
          </span>
        )}
      </div>

      {sorted.length === 0 ? (
        <p className="py-2 text-center text-xs text-muted-foreground">No open games right now — check back in a moment.</p>
      ) : (
        <div className="space-y-2">
          {sorted.map((c) => (
            <TickerRow
              key={c.matchId}
              gameId={c.gameId}
              c={c}
              now={now}
              nameByGame={nameByGame}
              onJoin={() => onJoin({ matchId: c.matchId, gameId: c.gameId, stake: c.stake })}
            />
          ))}
        </div>
      )}

      <button
        type="button"
        onClick={onSignIn}
        data-testid="home-ticker-signin"
        className="mt-3 w-full rounded-full bg-brand px-5 py-2 text-xs font-bold text-white transition-colors hover:brightness-105"
      >
        Sign in to play
      </button>
    </section>
  );
}

/** §4 — leaderboard-lite for one game (reuses Leaderboard's formatStat). */
function HomeLeaderboard({ token, gameId }: { token: string; gameId: string }) {
  const [entries, setEntries] = useState<LeaderboardEntry[]>([]);
  useEffect(() => {
    let alive = true;
    api.leaderboard(gameId, token).then((e) => { if (alive && Array.isArray(e)) setEntries(e); }).catch(() => {});
    return () => { alive = false; };
  }, [token, gameId]);

  return (
    <section data-testid="home-leaderboard" aria-label="Leaderboard" className="rounded-2xl border border-border bg-card p-4">
      <h2 className="mb-3 text-sm font-bold uppercase tracking-wide text-foreground">Top players · {titleCase(gameId)}</h2>
      {entries.length === 0 ? (
        <p className="py-1 text-xs text-muted-foreground">No matches yet — play to claim the top spot.</p>
      ) : (
        <div className="space-y-1.5">
          {entries.slice(0, 5).map((e) => (
            <div key={e.playerId} data-testid={`home-rank-${e.playerId}`} className="flex items-center gap-3 rounded-lg bg-surface px-3 py-2">
              <span className="w-5 text-center text-sm font-bold text-muted-foreground">{e.rank}</span>
              <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">{e.displayName}</span>
              <span className="text-sm font-bold tabular-nums text-foreground/80">{formatStat(e)}</span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
