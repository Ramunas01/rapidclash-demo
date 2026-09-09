import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { GameMeta, OpenChallenge } from '@rapidclash/shared';
import { api } from '../api.js';
import { cn } from '@/lib/utils';
import { HubRibbon } from '../components/hub-chrome/HubRibbon.js';
import { HubToolbar } from '../components/hub-chrome/HubToolbar.js';
import { MenuOverlay } from '../components/hub-chrome/MenuOverlay.js';
import { useMenuOverlay } from '../components/hub-chrome/useMenuOverlay.js';
import { HUB_SHELL } from '../components/hub-chrome/layout.js';
import { TILE_ART, COMING_SOON, titleCase } from '../components/hub-shared/tiles.js';
import { GamesCarousel } from '../components/hub-shared/GamesCarousel.js';
import { BringARival } from '../components/hub-shared/BringARival.js';
import { HubFooter } from '../components/hub-shared/HubFooter.js';
import hero1 from '../assets/banners/hero-1.webp';
import hero2 from '../assets/banners/hero-2.webp';
// Third slide of the Designer's final 3-banner set (trophy / "Win Real Rivals' Stakes").
import heroFront from '../assets/banners/hero-front.webp';
import boltMark from '../assets/brand/bolt-mark.webp';
import diceRush from '../assets/events/dice-rush.webp';

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
  /** Rewards tab → the VIP/Rewards hub (issue #307). */
  onOpenRewards(): void;
  /** Menu overlay's own EARN → "Affiliate program" row (issue #423). */
  onOpenAffiliate(): void;
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
 * sanitized footer. Presentation only — real data, play-money credits, no house games playable.
 */
export function HomeHubScreen({
  token, balance, challengesByGame, onTrackChallenges, onUntrackChallenges,
  onTakeChallenge, onTakePublicChallenge, onSelectGame, onOpenWallet, onOpenRewards, onOpenAffiliate, onHome, loggedIn = true,
}: Props) {
  const [games, setGames] = useState<GameMeta[]>([]);
  const [liveBalance, setLiveBalance] = useState(balance);
  // Issue #414: the Menu overlay's own open/close/reveal-origin state.
  const menu = useMenuOverlay();
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
    <div className={HUB_SHELL}>
      <HubRibbon balance={loggedIn ? liveBalance : null} onLogo={onHome} onWallet={onOpenWallet} loggedIn={loggedIn} />

      <main data-testid="home-hub">
        <div className="mx-auto flex w-full max-w-md flex-col gap-6">
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
              <img src={boltMark} alt="" aria-hidden="true" className="h-5 w-5 -translate-y-[3px] object-contain" />
              <h2 className="text-[15px] font-black uppercase leading-none tracking-[0.04em]">{CAT_TITLE[cat]}</h2>
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

          {/* Games-page Open Games carousel (issue #305) — real feed only (never fabricated).
              Signed in → the live WS aggregate; logged out → a polled public snapshot of the
              same resting challenges. Also hosts the static 24H RACE/WEEKLY RACE/RANK tabs. */}
          <GamesCarousel
            challengesByGame={challengesByGame}
            nameByGame={nameByGame}
            balance={liveBalance}
            onTake={onTakeChallenge}
            onTakePublicChallenge={onTakePublicChallenge}
            loggedIn={loggedIn}
          />

          <BringARival />
        </div>

        <HubFooter onGames={onHome} onRewards={onOpenRewards} />
      </main>

      <HubToolbar
        onGames={menu.wrap(onHome)}
        onAccount={menu.wrap(onOpenWallet)}
        onRewards={menu.wrap(onOpenRewards)}
        onMenu={menu.onMenu}
        active={menu.open ? 'menu' : 'games'}
      />
      <MenuOverlay
        open={menu.open}
        anchorRect={menu.anchorRect}
        onClose={menu.close}
        onOpenGames={onHome}
        onOpenRewards={onOpenRewards}
        onOpenAffiliate={onOpenAffiliate}
      />
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

const HERO_SLIDES: { src: string; alt: string }[] = [
  { src: hero1, alt: 'RapidClash — Players vs Players, Never the House' },
  { src: hero2, alt: 'RapidClash — provably fair: no house, no edge, real opponents only' },
  { src: heroFront, alt: "RapidClash — win real rivals' stakes: beat players, take the prize" },
];

/** Promo hero — a swipeable carousel of static play-money banners with the frame's dot
 *  indicator. Three slides ship as the Designer's final approved set (the frame supports up to
 *  5): Never-the-House → No-House-No-Edge → Win-Real-Rivals, a thesis → fairness → compete arc. */
function HeroCarousel() {
  const [index, setIndex] = useState(0);
  const trackRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = trackRef.current;
    if (!el) return;
    // Gap-aware: each card is full-width with a gap-4 (16px) between cards, so a page advances by
    // clientWidth + gap, not clientWidth alone. Measure the actual spacing between the first two
    // rendered cards' offsetLeft so this stays correct regardless of gap size or slide count (up to 5).
    const onScroll = () => {
      const first = el.children[0] as HTMLElement | undefined;
      const second = el.children[1] as HTMLElement | undefined;
      const page = first && second ? second.offsetLeft - first.offsetLeft : el.clientWidth;
      setIndex(Math.round(el.scrollLeft / Math.max(1, page)));
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => el.removeEventListener('scroll', onScroll);
  }, []);
  return (
    <section data-testid="home-hero" aria-label="Players vs Players, never the house" className="px-4 pt-2">
      <div ref={trackRef} className="no-scrollbar flex snap-x snap-mandatory gap-4 overflow-x-auto">
        {HERO_SLIDES.map(({ src, alt }, i) => (
          <img
            key={i}
            src={src}
            alt={alt}
            // ~2.8:1 (2120/754, Designer #6) so the content below moves up; object-cover on the
            // Designer's final drop-in set (already 2120×754, no cropping needed). rounded-[18px]
            // lives on each card (not the track) so cards read as separate tiles with a gap between.
            className="aspect-[2120/754] w-full shrink-0 snap-center rounded-[18px] object-cover"
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
        className="flex h-11 items-center gap-1.5 rounded-[22px] bg-surface px-3.5 text-[13px] font-semibold text-muted-foreground transition-colors hover:text-foreground focus:outline-none"
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
      <img
        src={diceRush}
        alt="Dice Rush tournament — one roll per round, highest number wins the bracket"
        data-testid="home-events"
        className="block h-auto w-full rounded-[18px]"
      />
    </div>
  );
}
