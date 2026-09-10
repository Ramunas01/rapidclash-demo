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
import {
  CATEGORY_IDS, CATEGORY_TAB_LABEL, CATEGORY_TITLE, isInCategory, type CategoryId,
} from '../components/hub-shared/categories.js';
import {
  OriginalsIcon, CardGamesIcon, ChanceGamesIcon, SkillGamesIcon, EventsIcon,
} from '../components/hub-shared/categoryIcons.js';
import {
  SORT_MODES, SORT_LABEL, INTRO_ORDER, GRID_ORDER, RANDOM_PLAYABLE_GAME_IDS, RANDOM_TOTAL_MS, type SortMode,
} from '../components/hub-shared/gameSort.js';
import hero1 from '../assets/banners/hero-1.webp';
import hero2 from '../assets/banners/hero-2.webp';
// Third slide of the Designer's final 3-banner set (trophy / "Win Real Rivals' Stakes").
import heroFront from '../assets/banners/hero-front.webp';
import boltMark from '../assets/brand/bolt-mark.webp';

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
 * Home hub — the landing for everyone. Games-page hero rebuilt for the new design (issue #465):
 * promo hero carousel (UNCHANGED — carried over from production, out of this rebuild's scope),
 * a 5-tab category rail (ORIGINALS/CARD GAMES/CHANCE GAMES/SKILL GAMES/EVENTS, many-to-many —
 * see `hub-shared/categories.ts`), SEARCH/SORT/RANDOM controls, a section title, an art-only 3-up
 * game grid, a "Bring a Rival" card, the scrolling Open Games ticker, and a sanitized footer.
 * Presentation only — real data, play-money credits, no house games playable.
 */
export function HomeHubScreen({
  token, balance, challengesByGame, onTrackChallenges, onUntrackChallenges,
  onTakeChallenge, onTakePublicChallenge, onSelectGame, onOpenWallet, onOpenRewards, onOpenAffiliate, onHome, loggedIn = true,
}: Props) {
  const [games, setGames] = useState<GameMeta[]>([]);
  const [liveBalance, setLiveBalance] = useState(balance);
  // Issue #465: all-time settled-match count per gameId, backing the SORT sheet's default
  // "Popularity" mode. Public endpoint — fetched regardless of loggedIn, same as /games.
  const [popularity, setPopularity] = useState<Record<string, number>>({});
  // Issue #414: the Menu overlay's own open/close/reveal-origin state.
  const menu = useMenuOverlay();
  useEffect(() => { setLiveBalance(balance); }, [balance]);
  useEffect(() => {
    let alive = true;
    // /games is public; the wallet is auth-only — only fetch it when signed in.
    if (loggedIn) api.wallet(token).then((w) => { if (alive) setLiveBalance(w.balance); }).catch(() => {});
    api.games(token).then((g) => { if (alive && Array.isArray(g)) setGames(g); }).catch(() => {});
    api.gamePopularity().then((p) => { if (alive && p && typeof p === 'object') setPopularity(p); }).catch(() => {});
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

  // Grid controls (client-side, presentation only). Category defaults to ORIGINALS (all 12).
  const [cat, setCat] = useState<CategoryId>('originals');
  const [sort, setSort] = useState<SortMode>('popularity');
  const [query, setQuery] = useState('');

  // SEARCH (Owner-resolved 2026-09-09): case-insensitive substring on display name, across ALL
  // games regardless of the active category tab. Empty query → normal category-filtered view.
  const trimmedQuery = query.trim();
  const searching = trimmedQuery.length > 0;

  const shownTiles = useMemo(() => {
    const q = trimmedQuery.toLowerCase();
    const base = q
      ? tiles.filter((t) => t.name.toLowerCase().includes(q))
      : tiles.filter((t) => isInCategory(t.id, cat));

    const sorted = [...base];
    if (sort === 'alphabetical') {
      sorted.sort((a, b) => a.name.localeCompare(b.name));
    } else if (sort === 'newest') {
      // Descending ordinal — the highest (most-recently-added) ordinal sorts first.
      sorted.sort((a, b) => (INTRO_ORDER[b.id] ?? -1) - (INTRO_ORDER[a.id] ?? -1));
    } else {
      sorted.sort((a, b) => {
        const diff = (popularity[b.id] ?? 0) - (popularity[a.id] ?? 0);
        if (diff !== 0) return diff;
        // Tie-break (issue #476): the design's own GRID order (Coinflip first), not alphabetical —
        // alphabetical would put Baccarat first on a fresh/quiet DB where every count is 0.
        return (GRID_ORDER[a.id] ?? Infinity) - (GRID_ORDER[b.id] ?? Infinity);
      });
    }
    return sorted;
  }, [tiles, cat, sort, trimmedQuery, popularity]);

  // EVENTS is empty by design (the prototype's own `catEmpty` state) — but only when there's no
  // active search; a search always looks across all 12 games regardless of the active tab.
  const eventsEmpty = !searching && cat === 'events';

  // RANDOM (issue #465, prototype's `spinRandom`): spins for RANDOM_TOTAL_MS (1560ms — a 1500ms
  // die-spin keyframe + a 60ms post-settle delay), then navigates to a uniformly-random pick among
  // exactly the six PLAYABLE games (never one of the six with no dedicated hub today — see
  // `gameSort.ts`'s RANDOM_PLAYABLE_GAME_IDS doc comment).
  const [randSpinning, setRandSpinning] = useState(false);
  const randTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (randTimer.current) clearTimeout(randTimer.current); }, []);

  function handleRandom() {
    if (randSpinning) return; // re-entrancy guard, matches the prototype's own `if (randSpin) return`
    setRandSpinning(true);
    randTimer.current = setTimeout(() => {
      setRandSpinning(false);
      const pool = games.filter((g) => (RANDOM_PLAYABLE_GAME_IDS as readonly string[]).includes(g.id));
      if (pool.length === 0) return; // playable games not loaded yet — nothing safe to navigate to
      const pick = pool[Math.floor(Math.random() * pool.length)];
      onSelectGame(pick);
    }, RANDOM_TOTAL_MS);
  }

  return (
    <div className={HUB_SHELL}>
      <HubRibbon balance={loggedIn ? liveBalance : null} onLogo={onHome} onWallet={onOpenWallet} loggedIn={loggedIn} />

      <main data-testid="home-hub">
        <div className="mx-auto flex w-full max-w-md flex-col gap-6">
          <HeroCarousel />

          {/* Game grid — the prime real-estate: category rail + SEARCH/SORT/RANDOM + art-only tiles. */}
          <section data-testid="home-grid" aria-label="Games">
            <CategoryTabs cat={cat} onChange={setCat} />
            <GridControls
              query={query} onQuery={setQuery}
              sort={sort} onSort={setSort}
              onRandom={handleRandom} randSpinning={randSpinning}
            />
            <div className="mb-3 mt-[26px] flex items-center gap-3 px-4">
              <img src={boltMark} alt="" aria-hidden="true" className="h-[26px] w-[26px] -translate-y-[3px] object-contain" />
              <h2 data-testid="home-section-title" className="text-[15px] font-black uppercase leading-none tracking-[0.04em]">
                {CATEGORY_TITLE[cat]}
              </h2>
            </div>

            {eventsEmpty ? (
              <div data-testid="home-events-empty" className="flex items-center justify-center px-4 py-[54px] pb-2.5">
                <span className="text-sm font-semibold tracking-[0.02em] text-[var(--rc-text)]">No events running</span>
              </div>
            ) : shownTiles.length === 0 ? (
              <p className="px-4 py-6 text-center text-xs text-[var(--rc-muted)]">No games match — try a different search or category.</p>
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
        // Issue #465: the GAMES group's "RapidClash Originals"/"Card games"/"Chance games"/
        // "Skill games" rows — previously permanent placeholder toasts — now open THIS games
        // view pre-filtered to the tapped category. Menu is rendered by HomeHub itself, so this
        // is a direct, local state update: no round-trip through App-level routing needed.
        onOpenGamesCategory={setCat}
      />
    </div>
  );
}

/* ── Hero carousel (UNCHANGED — out of scope for #465, carried over from production as-is) ──── */

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

/* ── Category rail (ORIGINALS / CARD GAMES / CHANCE GAMES / SKILL GAMES / EVENTS) ──────────── */

const CATEGORY_ICON: Record<CategoryId, (props: { className?: string }) => ReactNode> = {
  originals: OriginalsIcon,
  card: CardGamesIcon,
  chance: ChanceGamesIcon,
  skill: SkillGamesIcon,
  events: EventsIcon,
};

function CategoryTabs({ cat, onChange }: { cat: CategoryId; onChange(c: CategoryId): void }) {
  return (
    <div className="no-scrollbar flex gap-2.5 overflow-x-auto px-4 pt-1 pb-[9px]" role="tablist" aria-label="Game categories">
      {CATEGORY_IDS.map((id) => {
        const active = cat === id;
        const Icon = CATEGORY_ICON[id];
        return (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={active}
            data-testid={`home-cat-${id}`}
            onClick={() => onChange(id)}
            className={cn(
              'flex h-[77px] w-[76px] shrink-0 flex-col items-center justify-center gap-2.5 rounded-[14px] px-1 text-center transition-colors focus:outline-none',
              active ? 'bg-brand/10' : 'bg-surface',
            )}
          >
            <Icon className={cn('block h-[26px] w-[26px]', active ? 'text-brand drop-shadow-[0_0_5px_hsl(var(--primary)/0.6)]' : 'text-[var(--rc-muted)]')} />
            <span className={cn('text-[11px] font-extrabold leading-[1.25]', active ? 'text-brand' : 'text-[var(--rc-muted)]')}>
              {CATEGORY_TAB_LABEL[id]}
            </span>
          </button>
        );
      })}
    </div>
  );
}

/* ── SEARCH / SORT / RANDOM ─────────────────────────────────────────────────────────────────── */

const SEARCH_ICON = (
  <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
    <circle cx="10.6" cy="10.6" r="6.9" />
    <path d="M15.8 15.8 21 21" />
  </svg>
);

const SORT_ICON = (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round">
    <path d="M3.6 6.6h16.8M6.4 12h11.2M9.6 17.4h4.8" />
  </svg>
);

const CHEVRON_DOWN = (
  <svg width="15" height="15" viewBox="0 0 24 24"><path d="M4.4 7.8 19.6 7.8 12 16.6z" fill="currentColor" /></svg>
);

const DIE_ICON = (
  <svg width="18" height="18" viewBox="0 0 24 24">
    <rect x="3" y="3" width="18" height="18" rx="5" fill="currentColor" />
    <circle cx="8.4" cy="8.4" r="1.7" className="fill-surface" />
    <circle cx="15.6" cy="8.4" r="1.7" className="fill-surface" />
    <circle cx="12" cy="12" r="1.7" className="fill-surface" />
    <circle cx="8.4" cy="15.6" r="1.7" className="fill-surface" />
    <circle cx="15.6" cy="15.6" r="1.7" className="fill-surface" />
  </svg>
);

const CHECK_ICON = (
  <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
    <path d="M4.5 12.6 9.8 18 19.5 6.6" />
  </svg>
);

function GridControls({
  query, onQuery, sort, onSort, onRandom, randSpinning,
}: {
  query: string; onQuery(q: string): void;
  sort: SortMode; onSort(s: SortMode): void;
  onRandom(): void; randSpinning: boolean;
}) {
  const [searchOpen, setSearchOpen] = useState(false);
  const [sortOpen, setSortOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  function openSearch() {
    setSearchOpen(true);
    requestAnimationFrame(() => inputRef.current?.focus());
  }
  function closeSearch() {
    setSearchOpen(false);
    onQuery('');
  }

  return (
    <div className="mt-3.5 flex items-center gap-2.5 px-4">
      <div
        className={cn(
          'flex h-11 items-center gap-2.5 overflow-hidden rounded-full bg-surface px-3.5 transition-all duration-[380ms] ease-out',
          searchOpen ? 'flex-1' : 'w-11 shrink-0 flex-none',
        )}
      >
        <button
          type="button"
          aria-label="Search games"
          data-testid="home-search-toggle"
          onClick={openSearch}
          className="grid h-[19px] w-[19px] shrink-0 place-items-center text-[var(--rc-muted)]"
        >
          {SEARCH_ICON}
        </button>
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => onQuery(e.target.value)}
          placeholder="Search Game"
          aria-label="Search games"
          data-testid="home-search-input"
          className={cn(
            'h-11 min-w-0 flex-1 border-none bg-transparent text-sm font-semibold text-[var(--rc-text)] outline-none placeholder:text-[var(--rc-muted)] transition-opacity duration-[380ms]',
            searchOpen ? 'opacity-100' : 'pointer-events-none w-0 opacity-0',
          )}
        />
      </div>

      {searchOpen && (
        <span
          onClick={closeSearch}
          role="button"
          tabIndex={0}
          data-testid="home-search-cancel"
          className="shrink-0 cursor-pointer whitespace-nowrap text-sm font-semibold text-[var(--rc-muted)]"
        >
          Cancel
        </span>
      )}

      {!searchOpen && (
        <>
          <button
            type="button"
            data-testid="home-sort-toggle"
            onClick={() => setSortOpen(true)}
            className="flex h-11 shrink-0 items-center gap-1.5 rounded-full bg-surface px-3.5 text-[13px] font-bold text-[var(--rc-muted)] transition-colors hover:text-[var(--rc-text)] focus:outline-none"
          >
            {SORT_ICON}
            SORT
            <span className={cn('block transition-transform duration-300', sortOpen && 'rotate-180')}>{CHEVRON_DOWN}</span>
          </button>

          <button
            type="button"
            data-testid="home-random"
            aria-label="Random game"
            onClick={onRandom}
            className="flex h-11 shrink-0 items-center gap-2.5 rounded-full bg-surface px-3.5 text-[13px] font-bold text-[var(--rc-muted)] transition-colors hover:text-[var(--rc-text)] focus:outline-none"
          >
            <span className={cn('block', randSpinning && 'animate-spin')}>{DIE_ICON}</span>
            RANDOM
          </button>
        </>
      )}

      <SortSheet sort={sort} onSort={onSort} open={sortOpen} onClose={() => setSortOpen(false)} />
    </div>
  );
}

/** SORT sheet (prototype's `sortOpen` modal) — a centered sheet over a dimmed backdrop, three
 *  fixed options (Popularity default / Newest / Alphabetical), the active one tinted + checked.
 *  Background reads the `--rc-sort-sheet-bg` token (issue #472 — light `#D3D3DD` / dark
 *  `#1A1A2E`, the prototype's own dedicated `sortSheetBg` value, line 4005) rather than
 *  `bg-card`, so it actually re-themes with the rest of the app. */
function SortSheet({
  sort, onSort, open, onClose,
}: { sort: SortMode; onSort(s: SortMode): void; open: boolean; onClose(): void }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-30" data-testid="home-sort-sheet">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="absolute left-[26px] right-[26px] top-1/2 -translate-y-1/2 rounded-[26px] bg-[var(--rc-sort-sheet-bg)] p-2 shadow-2xl">
        <div className="flex items-center gap-2.5 px-4 pb-2.5 pt-3">
          <span className="block w-5" aria-hidden="true" />
          <span className="flex-1 text-center text-[15px] font-bold tracking-[0.06em] text-[var(--rc-text)]">SORT</span>
          <button
            type="button"
            aria-label="Close sort"
            data-testid="home-sort-close"
            onClick={onClose}
            className="grid h-5 w-5 shrink-0 place-items-center text-[var(--rc-text)]"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
              <path d="M4.5 12.6 9.8 18 19.5 6.6" />
            </svg>
          </button>
        </div>
        {SORT_MODES.map((mode) => {
          const active = sort === mode;
          return (
            <button
              key={mode}
              type="button"
              data-testid={`home-sort-opt-${mode}`}
              onClick={() => { onSort(mode); onClose(); }}
              className={cn('flex w-full items-center gap-3 rounded-[18px] px-4 py-3.5 text-left', active && 'bg-brand/10')}
            >
              <span className={cn('grid h-[22px] w-[22px] shrink-0 place-items-center', active ? 'text-brand' : 'text-[var(--rc-muted)]')}>
                {SORT_OPTION_ICON[mode]}
              </span>
              <span className="flex-1 text-[13px] font-bold uppercase tracking-[0.04em] text-[var(--rc-text)]">{SORT_LABEL[mode]}</span>
              {active && <span className="text-brand">{CHECK_ICON}</span>}
            </button>
          );
        })}
      </div>
    </div>
  );
}

const SORT_OPTION_ICON: Record<SortMode, ReactNode> = {
  popularity: (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor">
      <path d="M12.6 2.2c.5 3.2-.9 4.9-2.5 6.5-1.9 1.9-3.5 3.6-3.5 6.2a6.4 6.4 0 0 0 12.8.2c0-1.9-.7-3.5-1.8-4.9.1 1.3-.3 2.3-1 3 .2-4-1.7-8-4-11z" />
    </svg>
  ),
  newest: (
    <svg width="22" height="22" viewBox="0 0 24 24">
      <circle cx="12" cy="12" r="9.4" fill="currentColor" />
      <text x="12" y="15" textAnchor="middle" fontFamily="Arial, Helvetica, sans-serif" fontSize="7" fontWeight="bold" className="fill-surface">NEW</text>
    </svg>
  ),
  alphabetical: (
    <svg width="22" height="22" viewBox="1.6 1.6 20.8 20.8">
      <path d="M10.2 6 13.8 6 12 3z" fill="currentColor" />
      <text x="12" y="15.8" textAnchor="middle" fontFamily="Arial, Helvetica, sans-serif" fontSize="9.5" fontWeight="bold" fill="currentColor">AZ</text>
      <path d="M10.2 18.4 13.8 18.4 12 21.4z" fill="currentColor" />
    </svg>
  ),
};

/* ── Tiles (art-only) ──────────────────────────────────────────────────────── */

function PlayableTile({ meta, onSelect }: { meta: GameMeta; onSelect(m: GameMeta): void }) {
  return (
    <button
      type="button"
      onClick={() => onSelect(meta)}
      aria-label={`Play ${meta.displayName}`}
      data-testid={`home-tile-${meta.id}`}
      className="group relative aspect-[112/158] overflow-hidden rounded-xl border border-[var(--rc-surface)] transition-transform duration-300 hover:-translate-y-0.5 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand"
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
      className="relative aspect-[112/158] overflow-hidden rounded-xl border border-[var(--rc-surface)] opacity-50"
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
