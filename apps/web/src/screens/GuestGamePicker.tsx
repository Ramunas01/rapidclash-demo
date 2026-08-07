import { GUEST_CURATED_GAMES } from '@rapidclash/shared';
import { TILE_ART, titleCase } from '../components/hub-shared/tiles.js';

interface Props {
  onSelect(gameId: string): void;
}

/** Guest mode's landing surface (issue #279) — a minimal picker, deliberately NOT the real
 *  `GameListScreen`: that screen fetches the full `/games` roster, renders "coming soon" breadth
 *  tiles for the whole platform, and carries a full marketing hero + back-to-lobby chrome — none
 *  of which belongs on a curated, no-fetch guest surface (GUEST_MODE_STRATEGY.md §7: guest mode
 *  stays a thin config layer). Data-driven off `GUEST_CURATED_GAMES` (never hardcoded per surface)
 *  so a future third curated game needs no change here. Reuses the same tile-art primitive as the
 *  hub's `RelatedRail` (`TILE_ART`/`titleCase`) — the cheapest adaptation from the real grid. */
export function GuestGamePicker({ onSelect }: Props) {
  return (
    <div className="min-h-screen bg-[#0b0e18] px-4 py-10 text-white" data-testid="guest-game-picker">
      <div className="mx-auto max-w-md">
        <h1 className="mb-1 text-xl font-bold">Try RapidClash</h1>
        <p className="mb-6 text-sm text-white/60">Pick a game — instant match against our Demo Opponent.</p>
        <div className="grid grid-cols-2 gap-3">
          {GUEST_CURATED_GAMES.map((gameId) => (
            <button
              key={gameId}
              type="button"
              onClick={() => onSelect(gameId)}
              aria-label={`Play ${titleCase(gameId)}`}
              data-testid={`guest-picker-${gameId}`}
              className="group relative aspect-[3/4] overflow-hidden rounded-2xl border border-white/5 transition-all duration-300 hover:-translate-y-1 hover:scale-[1.03] hover:border-purple-500/30 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand"
            >
              <PickerTileArt gameId={gameId} />
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function PickerTileArt({ gameId }: { gameId: string }) {
  const art = TILE_ART[gameId];
  const name = titleCase(gameId);
  if (art) {
    return (
      <>
        <img
          src={art}
          alt=""
          aria-hidden="true"
          loading="lazy"
          decoding="async"
          className="absolute inset-0 h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
        />
        <div className="absolute inset-0 bg-gradient-to-b from-black/10 via-black/5 to-black/80" />
        <span className="absolute bottom-3 left-1/2 -translate-x-1/2 text-sm font-black uppercase tracking-wide text-white">
          {name}
        </span>
      </>
    );
  }
  return (
    <div className="absolute inset-0 flex items-center justify-center bg-gradient-to-br from-brand/30 to-indigo-900/50">
      <span className="px-1 text-center text-sm font-black uppercase tracking-wide text-white/85">{name}</span>
    </div>
  );
}
