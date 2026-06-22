import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { GameMeta, OpenChallenge, PublicOpenChallenge } from '@rapidclash/shared';
import { api } from '../api.js';
import { formatCredits } from '../format.js';
import { cn } from '@/lib/utils';
import { HubRibbon } from '../components/hub-chrome/HubRibbon.js';
import { HubToolbar } from '../components/hub-chrome/HubToolbar.js';
import hero1 from '../assets/banners/hero-1.webp';
import hero2 from '../assets/banners/hero-2.webp';
import boltMark from '../assets/brand/bolt-mark.webp';
import boltDecor from '../assets/brand/bolt-decor.webp';
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

/** v2 tile art keyed by gameId. No `limbo` — the frame's Limbo tile bakes in "900x/800x/700x"
 *  house-multiplier framing (rejected, as in #99); it falls back to a clean gradient tile. */
const TILE_ART: Record<string, string> = {
  rps: rpsArt, coinflip: coinflipArt, chess: chessArt, blackjack: blackjackArt, mines: minesArt,
  baccarat: baccaratArt, crash: crashArt, dice: diceArt, hilo: hiloArt, keno: kenoArt, roulette: rouletteArt,
};

/** Breadth: games not (yet) returned by /games render as dimmed, non-playable "coming soon"
 *  tiles. The whole house canon is a PvP-redefinition target (CHARTER / GAME_REDEFINITION) —
 *  never shown in house form, never a playable house route (invariant #1). */
const COMING_SOON = ['baccarat', 'limbo', 'crash', 'keno', 'hilo', 'dice', 'roulette'];

/** Demo taxonomy for the Filter control (Card / Table / Logic). Client-side, presentation only. */
const GAME_KIND: Record<string, 'card' | 'table' | 'logic'> = {
  chess: 'logic', rps: 'logic', mines: 'logic',
  coinflip: 'table', dice: 'table', roulette: 'table', crash: 'table', keno: 'table', limbo: 'table',
  blackjack: 'card', baccarat: 'card', hilo: 'card',
};

/** Demo popularity metric for the Sort control (higher = more popular). Static — not real data. */
const POPULARITY: Record<string, number> = {
  coinflip: 100, blackjack: 92, chess: 88, mines: 80, rps: 74,
  crash: 60, dice: 55, roulette: 50, hilo: 45, keno: 40, baccarat: 35, limbo: 30,
};

function titleCase(id: string): string {
  return id.charAt(0).toUpperCase() + id.slice(1);
}

type Cat = 'all' | 'originals' | 'classics' | 'events';
type Kind = 'all' | 'card' | 'table' | 'logic';
type Sort = 'popular' | 'az' | 'za';

/** A unified grid entry — a live playable game (from /games) or a coming-soon breadth tile. */
interface Tile {
  id: string;
  name: string;
  playable: boolean;
  meta?: GameMeta;
}

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
  /** Logged out → no wallet/feed (auth-required); browse stays open, control is "Sign in". */
  loggedIn?: boolean;
}

/**
 * Home hub — the landing for everyone. A 1:1 transfer of the Start_Building_Frame design
 * (fixed-width mobile composition): promo hero carousel, group tabs (All/Originals/Classics/
 * Events) + Find/Filter/Sort, an art-only 3-up game grid (PvP playable vs dimmed coming-soon),
 * a "Bring a Rival" card, the scrolling Open Games ticker (real feed; teaser-free), and a
 * sanitized footer. Presentation only — real data, play-money ¢, no house games playable.
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

  // Subscribe to every playable game's challenge feed for the cross-game ticker (authed only;
  // the WS rides auth). Logged out → the public polled snapshot handles it. App merges per-game
  // lists into challengesByGame; re-runs only when the game set changes.
  const gameKey = games.map((g) => g.id).join(',');
  useEffect(() => {
    if (!loggedIn || games.length === 0) return;
    onTrackChallenges(games.map((g) => g.id));
    return () => onUntrackChallenges();
    // eslint-disable-next-line -- track once per game-set change (callbacks are stable)
  }, [gameKey, loggedIn]);

  const nameByGame = useMemo(() => new Map(games.map((g) => [g.id, g.displayName])), [games]);

  // The full roster: live playable tiles (data-driven) + coming-soon breadth tiles.
  const tiles = useMemo<Tile[]>(() => {
    const playable: Tile[] = games.map((g) => ({ id: g.id, name: g.displayName, playable: true, meta: g }));
    const live = new Set(games.map((g) => g.id));
    const soon: Tile[] = COMING_SOON.filter((id) => !live.has(id)).map((id) => ({ id, name: titleCase(id), playable: false }));
    return [...playable, ...soon];
  }, [games]);

  // Grid controls (client-side, presentation only — fidelity over exact behavior).
  const [cat, setCat] = useState<Cat>('all');
  const [kind, setKind] = useState<Kind>('all');
  const [sort, setSort] = useState<Sort>('popular');
  const [query, setQuery] = useState('');

  const shownTiles = useMemo(() => {
    let out = tiles;
    if (cat === 'originals') out = out.filter((t) => t.id !== 'chess');
    else if (cat === 'classics') out = out.filter((t) => t.id === 'chess');
    if (kind !== 'all') out = out.filter((t) => GAME_KIND[t.id] === kind);
    const q = query.trim().toLowerCase();
    if (q) out = out.filter((t) => t.name.toLowerCase().includes(q));
    const by = [...out];
    if (sort === 'az') by.sort((a, b) => a.name.localeCompare(b.name));
    else if (sort === 'za') by.sort((a, b) => b.name.localeCompare(a.name));
    else by.sort((a, b) => (POPULARITY[b.id] ?? 0) - (POPULARITY[a.id] ?? 0));
    return by;
  }, [tiles, cat, kind, sort, query]);

  return (
    <div className="flex h-[100dvh] flex-col bg-background text-foreground">
      <HubRibbon balance={loggedIn ? liveBalance : null} onLogo={onHome} onWallet={onOpenWallet} loggedIn={loggedIn} />

      <main className="flex-1 overflow-y-auto" data-testid="home-hub">
        <div className="mx-auto flex w-full max-w-md flex-col gap-6 pb-6">
          <HeroCarousel />

          {/* Game grid — the prime real-estate: group tabs + controls + art-only tiles. */}
          <section data-testid="home-grid" aria-label="Games">
            <CategoryTabs cat={cat} onChange={setCat} />
            <GridControls
              query={query} onQuery={setQuery}
              kind={kind} onKind={setKind}
              sort={sort} onSort={setSort}
            />
            <div className="mb-3 mt-5 flex items-center gap-2.5 px-4">
              <img src={boltMark} alt="" aria-hidden="true" className="h-5 w-5 object-contain" />
              <h2 className="text-[15px] font-black uppercase tracking-[0.04em]">{CAT_TITLE[cat]}</h2>
              {cat !== 'events' && (
                <span className="ml-auto text-xs text-muted-foreground">{shownTiles.length} games</span>
              )}
            </div>

            {cat === 'events' ? (
              <EventsBanner />
            ) : shownTiles.length === 0 ? (
              <p className="px-4 py-6 text-center text-xs text-muted-foreground">No games match — clear the filter or search.</p>
            ) : (
              <div className="grid grid-cols-3 gap-2 px-4">
                {shownTiles.map((t) =>
                  t.playable && t.meta
                    ? <PlayableTile key={t.id} meta={t.meta} onSelect={onSelectGame} />
                    : <ComingSoonTile key={t.id} id={t.id} />,
                )}
              </div>
            )}
          </section>

          <BringARival />

          {/* Open Games — real feed only (never fabricated). Signed in → the live WS aggregate;
              logged out → a polled public snapshot of the same resting challenges. */}
          {loggedIn ? (
            <OpenGamesTicker challengesByGame={challengesByGame} nameByGame={nameByGame} balance={liveBalance} onTake={onTakeChallenge} />
          ) : (
            <PublicOpenGamesTicker nameByGame={nameByGame} onJoin={(c) => onTakePublicChallenge?.(c)} onSignIn={onOpenWallet} />
          )}

          <Footer />
        </div>
      </main>

      <HubToolbar onGames={onHome} onAccount={onOpenWallet} active="games" />
    </div>
  );
}

const CAT_TITLE: Record<Cat, string> = {
  all: 'All Games',
  originals: 'RapidClash Originals',
  classics: 'Classics',
  events: 'Events',
};

/* ── Hero carousel ─────────────────────────────────────────────────────────── */

const HERO_SLIDES = [hero1, hero2];

/** Promo hero — a swipeable carousel of static play-money banners with the frame's dot
 *  indicator. Two slides ship (the designer allows up to 5), so the indicator is real. */
function HeroCarousel() {
  const [index, setIndex] = useState(0);
  const trackRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = trackRef.current;
    if (!el) return;
    const onScroll = () => setIndex(Math.round(el.scrollLeft / Math.max(1, el.clientWidth)));
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => el.removeEventListener('scroll', onScroll);
  }, []);
  return (
    <section data-testid="home-hero" aria-label="Players vs Players, never the house" className="px-4 pt-2">
      <div ref={trackRef} className="no-scrollbar flex snap-x snap-mandatory overflow-x-auto rounded-[18px]">
        {HERO_SLIDES.map((src, i) => (
          <img
            key={i}
            src={src}
            alt="RapidClash — Players vs Players, Never the House"
            className="w-full shrink-0 snap-center object-cover"
          />
        ))}
      </div>
      <div className="mt-3 flex justify-center gap-1.5">
        {HERO_SLIDES.map((_, i) => (
          <span
            key={i}
            aria-hidden="true"
            className={cn('h-[7px] rounded-full transition-all', index === i ? 'w-[18px] bg-brand' : 'w-[7px] bg-[#2a2a2a]')}
          />
        ))}
      </div>
    </section>
  );
}

/* ── Group tabs (All / Originals / Classics / Events) ──────────────────────── */

const CATS: { id: Cat; label: string; icon: ReactNode }[] = [
  {
    id: 'all', label: 'ALL GAMES',
    icon: (<svg width="26" height="26" viewBox="0 0 24 24" fill="currentColor"><rect x="3" y="3" width="8" height="8" rx="2" /><rect x="13" y="3" width="8" height="8" rx="2" /><rect x="3" y="13" width="8" height="8" rx="2" /><rect x="13" y="13" width="8" height="8" rx="2" /></svg>),
  },
  {
    id: 'originals', label: 'ORIGINALS',
    icon: (<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" strokeLinecap="round"><path d="M13 2L4.5 13.5H11L9 22L19.5 10H13L13 2Z" /></svg>),
  },
  {
    id: 'classics', label: 'CLASSICS',
    icon: (<svg width="26" height="26" viewBox="0 0 24 24" fill="currentColor"><rect x="3" y="5" width="18" height="14" rx="2" fill="none" stroke="currentColor" strokeWidth="2" /><circle cx="8" cy="12" r="2" /><circle cx="16" cy="12" r="2" /><path d="M11 12h2" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>),
  },
  {
    id: 'events', label: 'EVENTS',
    icon: (<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M8 21h8M12 17v4M7 4H5a2 2 0 0 0-2 2v1a4 4 0 0 0 4 4M17 4h2a2 2 0 0 1 2 2v1a4 4 0 0 1-4 4" /><path d="M7 4h10v7a5 5 0 0 1-10 0V4Z" /></svg>),
  },
];

function CategoryTabs({ cat, onChange }: { cat: Cat; onChange(c: Cat): void }) {
  return (
    <div className="no-scrollbar flex gap-2.5 overflow-x-auto px-4 pt-1" role="tablist" aria-label="Game groups">
      {CATS.map((c) => {
        const active = cat === c.id;
        return (
          <button
            key={c.id}
            type="button"
            role="tab"
            aria-selected={active}
            data-testid={`home-cat-${c.id}`}
            onClick={() => onChange(c.id)}
            className={cn(
              'flex h-20 w-20 shrink-0 flex-col items-center justify-center gap-2 rounded-[14px] transition-colors focus:outline-none',
              active ? 'bg-[#1a1030]' : 'bg-surface',
            )}
          >
            <span className={cn('flex', active ? 'text-brand drop-shadow-[0_0_5px_#8140e299]' : 'text-[#6a6a78]')}>{c.icon}</span>
            <span className={cn('text-[10px] font-extrabold tracking-[0.06em]', active ? 'text-brand drop-shadow-[0_0_8px_#8140e2bb]' : 'text-[#6a6a78]')}>{c.label}</span>
          </button>
        );
      })}
    </div>
  );
}

/* ── Find / Filter / Sort ──────────────────────────────────────────────────── */

function GridControls({
  query, onQuery, kind, onKind, sort, onSort,
}: {
  query: string; onQuery(q: string): void;
  kind: Kind; onKind(k: Kind): void;
  sort: Sort; onSort(s: Sort): void;
}) {
  const [findOpen, setFindOpen] = useState(false);
  return (
    <div className="flex items-center gap-2.5 px-4 pt-4">
      <button
        type="button"
        aria-label="Find a game"
        data-testid="home-find-toggle"
        onClick={() => { setFindOpen((o) => !o); if (findOpen) onQuery(''); }}
        className={cn('grid h-11 w-11 shrink-0 place-items-center rounded-full transition-colors focus:outline-none',
          findOpen ? 'bg-brand text-white' : 'bg-surface text-muted-foreground')}
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="7" /><path d="m20 20-3-3" /></svg>
      </button>

      {findOpen ? (
        <input
          autoFocus
          value={query}
          onChange={(e) => onQuery(e.target.value)}
          placeholder="Search games"
          aria-label="Search games"
          data-testid="home-find-input"
          className="h-11 flex-1 rounded-full bg-surface px-4 text-sm text-foreground outline-none placeholder:text-muted-foreground focus:ring-2 focus:ring-brand"
        />
      ) : (
        <>
          <ControlMenu
            testid="home-filter"
            label={kind === 'all' ? 'Filter' : KIND_LABEL[kind]}
            icon={<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M4 6h16M7 12h10M10 18h4" /></svg>}
            value={kind}
            options={[['all', 'All types'], ['card', 'Card games'], ['table', 'Table games'], ['logic', 'Logic games']]}
            onSelect={(v) => onKind(v as Kind)}
          />
          <ControlMenu
            testid="home-sort"
            label={SORT_LABEL[sort]}
            icon={<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M4 6h2M10 6h10M4 12h10M18 12h2M4 18h2M10 18h10" /></svg>}
            value={sort}
            options={[['popular', 'Popular'], ['az', 'A–Z'], ['za', 'Z–A']]}
            onSelect={(v) => onSort(v as Sort)}
          />
        </>
      )}
    </div>
  );
}

const KIND_LABEL: Record<Kind, string> = { all: 'Filter', card: 'Card games', table: 'Table games', logic: 'Logic games' };
const SORT_LABEL: Record<Sort, string> = { popular: 'Popular', az: 'A–Z', za: 'Z–A' };

function ControlMenu({
  testid, label, icon, value, options, onSelect,
}: {
  testid: string; label: string; icon: ReactNode; value: string;
  options: [string, string][]; onSelect(v: string): void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <button
        type="button"
        data-testid={testid}
        onClick={() => setOpen((o) => !o)}
        className="flex h-11 items-center gap-1.5 rounded-[22px] px-3.5 text-[13px] font-semibold text-muted-foreground transition-colors hover:text-foreground focus:outline-none"
      >
        {icon}
        {label}
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="m6 9 6 6 6-6" /></svg>
      </button>
      {open && (
        <div className="absolute left-0 top-12 z-30 min-w-[140px] overflow-hidden rounded-xl border border-border bg-card py-1 shadow-2xl">
          {options.map(([v, l]) => (
            <button
              key={v}
              type="button"
              data-testid={`${testid}-opt-${v}`}
              onClick={() => { onSelect(v); setOpen(false); }}
              className={cn('block w-full px-4 py-2 text-left text-[13px] transition-colors hover:bg-surface',
                value === v ? 'font-bold text-brand' : 'text-foreground')}
            >
              {l}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/* ── Tiles (art-only) ──────────────────────────────────────────────────────── */

function PlayableTile({ meta, onSelect }: { meta: GameMeta; onSelect(m: GameMeta): void }) {
  return (
    <button
      type="button"
      onClick={() => onSelect(meta)}
      aria-label={`Play ${meta.displayName}`}
      data-testid={`home-tile-${meta.id}`}
      className="group relative aspect-[2/3] overflow-hidden rounded-xl border border-border transition-transform duration-300 hover:-translate-y-0.5 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand"
    >
      <TileArt art={TILE_ART[meta.id]} name={meta.displayName} />
    </button>
  );
}

function ComingSoonTile({ id }: { id: string }) {
  return (
    <div
      aria-disabled="true"
      aria-label={`${titleCase(id)} — coming soon`}
      data-testid={`home-coming-soon-${id}`}
      className="relative aspect-[2/3] overflow-hidden rounded-xl border border-border opacity-50"
    >
      <TileArt art={TILE_ART[id]} name={titleCase(id)} />
      <span className="absolute right-1.5 top-1.5 rounded-full bg-black/55 px-1.5 py-0.5 text-[7px] font-bold uppercase tracking-wide text-white/80">
        Soon
      </span>
    </div>
  );
}

/** Tile backdrop: designed art when present, else a gradient + name fallback (e.g. Limbo). */
function TileArt({ art, name }: { art?: string; name: string }) {
  if (art) {
    return (
      <img
        src={art}
        alt=""
        aria-hidden="true"
        loading="lazy"
        decoding="async"
        className="absolute inset-0 h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
      />
    );
  }
  return (
    <div className="absolute inset-0 flex items-center justify-center bg-gradient-to-br from-brand/30 to-indigo-900/50">
      <span className="px-1 text-center text-sm font-black uppercase tracking-wide text-white/85">{name}</span>
    </div>
  );
}

/* ── Events banner (Coin Flip tournament announcement) ─────────────────────── */

function EventsBanner() {
  return (
    <div className="px-4">
      <div data-testid="home-events" className="relative overflow-hidden rounded-[14px] border border-border bg-surface p-5">
        <div className="pointer-events-none absolute -bottom-5 -right-3 h-28 w-28 opacity-90">
          <img src={boltDecor} alt="" aria-hidden="true" className="h-full w-full object-contain" />
        </div>
        <span className="inline-block rounded-full bg-brand/20 px-2.5 py-1 text-[10px] font-extrabold uppercase tracking-[0.1em] text-brand">
          Tournament · Save the date
        </span>
        <h3 className="relative mt-3 text-xl font-black">Coin Flip Showdown</h3>
        <p className="relative mt-1 text-sm font-bold text-foreground/80">1 September 2026</p>
        <p className="relative mt-2 max-w-[78%] text-[12.5px] leading-relaxed text-muted-foreground">
          A bracket of pure 50/50 nerve — last player standing takes the crown. Play-money entry, bragging rights only.
        </p>
        <button
          type="button"
          aria-disabled="true"
          className="relative mt-4 inline-flex cursor-default items-center gap-2 rounded-[10px] bg-brand/30 px-4 py-2.5 text-[13px] font-bold text-white/80"
        >
          Invitations open soon
        </button>
      </div>
    </div>
  );
}

/* ── Bring a Rival ─────────────────────────────────────────────────────────── */

function BringARival() {
  return (
    <section data-testid="home-rival" aria-label="Bring a rival" className="px-4">
      <div className="relative overflow-hidden rounded-[14px] border border-border bg-surface px-5 pb-5 pt-[18px]">
        <div className="pointer-events-none absolute -bottom-[18px] -right-[10px] h-[120px] w-[120px]">
          <img src={boltDecor} alt="" aria-hidden="true" className="h-full w-full object-contain" />
        </div>
        <h3 className="relative text-[17px] font-extrabold">Bring a Rival</h3>
        <p className="relative mt-1.5 max-w-[74%] text-[12.5px] leading-relaxed text-muted-foreground">
          Send a match link. They join, you both stake, the winner takes the pot.
        </p>
        <button
          type="button"
          aria-disabled="true"
          className="relative mt-3.5 inline-flex cursor-default items-center gap-2 rounded-[10px] bg-brand px-4 py-2.5 text-[13px] font-bold text-white"
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><circle cx="9" cy="8" r="3.2" /><path d="M3.5 20a5.5 5.5 0 0 1 11 0M18 9v6M21 12h-6" /></svg>
          Challenge a friend
        </button>
      </div>
    </section>
  );
}

/* ── Open Games ticker ─────────────────────────────────────────────────────── */

/** How often the logged-out ticker re-polls the public snapshot so the feed visibly moves. */
const PUBLIC_POLL_MS = 4_000;
/** Above this many rows, the list auto-scrolls (rows duplicated for a seamless loop). */
const SCROLL_THRESHOLD = 5;

/** One feed row — shared by the signed-in (WS) and logged-out (public) tickers. `clone` drops
 *  the test ids so the duplicated (scrolling) copy never collides with the real one. */
function TickerRow({ gameId, c, nameByGame, onJoin, clone = false }: {
  gameId: string;
  c: OpenChallenge;
  nameByGame: Map<string, string>;
  onJoin(): void;
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
        tabIndex={clone ? -1 : undefined}
        aria-hidden={clone || undefined}
        data-testid={clone ? undefined : `home-join-${c.matchId}`}
        aria-label={`Join ${c.ownerName}'s ${c.stake} credit ${gameName} game`}
        className="shrink-0 rounded-full bg-brand px-3.5 py-2 text-xs font-extrabold uppercase tracking-wide text-white transition-colors hover:brightness-105"
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

/** Signed-in: the live cross-game WS aggregate. */
function OpenGamesTicker({
  challengesByGame, nameByGame, balance, onTake,
}: {
  challengesByGame: Record<string, OpenChallenge[]>;
  nameByGame: Map<string, string>;
  balance: number;
  onTake(matchId: string): void;
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
          <EmptyTicker text="No open games right now — pick a tile to post one." />
        ) : (
          <TickerBody
            count={rows.length}
            rows={rows.map(({ gameId, c }) => <TickerRow key={c.matchId} gameId={gameId} c={c} nameByGame={nameByGame} onJoin={() => handleJoin(c)} />)}
            clones={rows.map(({ gameId, c }) => <TickerRow key={`clone-${c.matchId}`} clone gameId={gameId} c={c} nameByGame={nameByGame} onJoin={() => {}} />)}
          />
        )}
      </div>
    </section>
  );
}

/** Logged-out: the SAME feed from the public snapshot (GET /open-challenges), polled so it
 *  visibly moves. Real data only — never fabricated. JOIN hits the auth wall, which resumes
 *  the take after sign-in (no anonymous play). */
function PublicOpenGamesTicker({
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

function EmptyTicker({ text }: { text: string }) {
  return (
    <div className="rounded-[14px] border border-border bg-card px-4 py-6">
      <p className="text-center text-xs text-muted-foreground">{text}</p>
    </div>
  );
}

/* ── Footer ────────────────────────────────────────────────────────────────── */

const FOOTER_LINKS = ['How it works', 'Provably fair', 'Fees & rake', 'Tournaments', 'Help center', 'Responsible gaming', 'Terms'];

function Footer() {
  return (
    <footer data-testid="home-footer" className="mt-4 border-t border-border bg-[#0b0b0b] px-4 pb-6 pt-6">
      {/* Provably-fair — seeded-RNG determinism, NO on-chain/blockchain claim. */}
      <div className="mb-5 flex gap-3 rounded-[14px] bg-surface p-3.5">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="shrink-0 text-brand"><path d="M12 3 4 6v6c0 5 3.4 7.5 8 9 4.6-1.5 8-4 8-9V6l-8-3Z" /><path d="m8.5 12 2.3 2.3 4.7-4.6" /></svg>
        <p className="text-[11.5px] leading-relaxed text-muted-foreground">
          <b className="text-foreground">Provably fair, by design.</b> Every match runs on a seeded RNG you can verify — the platform never plays against you, just a flat fee per game.{' '}
          <span className="font-semibold text-brand">See how it works</span>
        </p>
      </div>

      <div className="mb-5 grid grid-cols-2 gap-x-3.5 gap-y-2.5">
        {FOOTER_LINKS.map((l) => (
          <span key={l} className="cursor-default text-[12.5px] text-muted-foreground">{l}</span>
        ))}
      </div>

      <div className="mb-3.5 flex items-start gap-3">
        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full border-[1.5px] border-muted-foreground text-xs font-extrabold text-muted-foreground">18+</span>
        <p className="text-[10.5px] leading-relaxed text-[#5b5b63]">
          RapidClash is a play-money demo for players aged 18 and over. Credits have no real-world value. Play responsibly, set limits, and take breaks.
        </p>
      </div>

      <div className="flex items-center gap-2 text-[10.5px] text-[#5b5b63]">
        <img src={boltMark} alt="" aria-hidden="true" className="h-4 w-4 object-contain" />
        © 2026 RapidClash · Players vs Players, Never the House.
      </div>
    </footer>
  );
}
