import { useCallback, useEffect, useRef, useState } from 'react';
import type { PublicOpenChallenge } from '@rapidclash/shared';
import { api } from '../api.js';
import { Credits } from '../components/hub-shared/RcIcon.js';
import { titleCase } from '../components/hub-shared/tiles.js';
import { PUBLIC_POLL_MS, insufficientBalanceNotice } from '../components/hub-shared/OpenGames.js';

/**
 * Guest-scoped "who's on duty" list (issue #354, part 5/5 of
 * `docs/COMMS/from-advisor/guest-mode-bot-economy.md` §D) — the guest-mode equivalent of
 * `GamesCarousel`'s Open Games list, for the ONE game the current guest hub is showing. NOT a
 * re-enable of that real component: `GameHub.tsx` deliberately omits `GamesCarousel` for guests
 * (`GUEST_MODE_CONTRACT.md` §4 — no live human matchmaking with strangers), and that component is
 * wired to the real cross-game WS aggregate (`challengesByGame`) anyway, which structurally can't
 * see guest-isolated data. This component never imports or touches that prop/aggregate at all —
 * its ONLY data source is `api.guestOpenChallenges()`, a dedicated guest-scoped REST read
 * (`apps/server/src/routes/guest-open-challenges.ts`) backed by the isolated guest `Matchmaking`
 * instance's currently-resting Demo-Opponent bot-waiters (issue #351's multi-stake pools). That is
 * the whole isolation guarantee, by construction: this component has no code path that could ever
 * reach a real player's data, because it never asks for it in the first place.
 *
 * JOIN reuses the existing `onTakeChallenge` WS wiring already threaded into every `GameHub`
 * instance (`App.tsx`'s `handleTakeChallenge` → `WsClient.takeChallenge` → the gateway's
 * `challenge.take`, which already dispatches against the guest `Matchmaking` instance for a guest
 * token — see `apps/server/src/ws/gateway.ts`'s `challenge.take` case) — no new WS message type.
 */
export interface GuestBotWaitersProps {
  /** The current hub's game — the list shows only this game's lanes (the guest is already inside
   *  that game's board; a cross-game list belongs on the picker, not here). */
  gameId: string;
  /** Live guest balance (App's `balance` prop, the same source `GameHub.tsx` already tracks as
   *  `liveBalance` — the server's ephemeral ledger, never `/wallet`). */
  balance: number;
  /** Sends WS `challenge.take` for the given matchId — `GameHub.tsx`'s existing `onTakeChallenge`. */
  onTake(matchId: string): void;
  /** Grey out every row's JOIN while already mid-commitment (mirrors `GamesCarousel`'s own
   *  `joinDisabled` — `GameHub.tsx` passes `phase === 'in-match' || phase === 'waiting'`). */
  joinDisabled?: boolean;
}

export function GuestBotWaiters({ gameId, balance, onTake, joinDisabled = false }: GuestBotWaitersProps) {
  const [rows, setRows] = useState<PublicOpenChallenge[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const aliveRef = useRef(true);

  const load = useCallback(() => {
    api.guestOpenChallenges()
      .then((r) => {
        if (!aliveRef.current || !Array.isArray(r)) return;
        setRows(r.filter((c) => c.gameId === gameId).sort((a, b) => a.stake - b.stake));
      })
      .catch(() => {}); // best-effort — an empty list is a safe fallback (same as GamesCarousel's public poll)
  }, [gameId]);

  useEffect(() => {
    aliveRef.current = true;
    load();
    const id = setInterval(load, PUBLIC_POLL_MS); // same cadence as the logged-out public ticker
    return () => {
      aliveRef.current = false;
      clearInterval(id);
    };
  }, [load]);

  function handleJoin(row: PublicOpenChallenge) {
    if (joinDisabled) return;
    const msg = insufficientBalanceNotice(row.stake, balance);
    if (msg) {
      setNotice(msg);
      return;
    }
    setNotice(null);
    onTake(row.matchId);
  }

  return (
    <section data-testid="guest-bot-waiters" aria-label="Demo Opponents on duty" className="px-4">
      <h2 className="mb-2 text-sm font-bold uppercase tracking-wide text-white/60">Demo Opponents on duty</h2>
      {rows.length === 0 ? (
        <p
          data-testid="guest-bot-waiters-empty"
          className="rounded-xl border border-white/5 bg-white/[0.03] px-4 py-6 text-center text-xs text-white/50"
        >
          No Demo Opponent resting right now — press PLAY to get matched.
        </p>
      ) : (
        <div className="flex flex-col gap-2">
          {rows.map((row) => (
            <div
              key={row.matchId}
              data-testid={`guest-bot-waiter-${row.stake}`}
              className="flex items-center justify-between gap-3 rounded-xl border border-white/5 bg-white/[0.03] px-4 py-3"
            >
              <div className="min-w-0">
                <div className="truncate text-sm font-semibold text-white">{row.ownerName}</div>
                <div className="mt-0.5 flex items-center gap-1 text-xs text-white/50">
                  Stake <Credits amount={row.stake} size={12} />
                </div>
              </div>
              <button
                type="button"
                data-testid={`guest-bot-waiter-join-${row.stake}`}
                onClick={() => handleJoin(row)}
                disabled={joinDisabled}
                aria-label={`Join the ${row.stake} credit ${titleCase(gameId)} game`}
                className="shrink-0 rounded-full bg-brand px-4 py-2 text-xs font-black uppercase tracking-wider text-white transition-opacity disabled:cursor-not-allowed disabled:opacity-40"
              >
                JOIN
              </button>
            </div>
          ))}
        </div>
      )}
      {notice && (
        <p
          role="alert"
          data-testid="guest-bot-waiters-notice"
          className="mt-2 rounded-lg border border-[#e0556c]/40 bg-[#e0556c]/10 px-3 py-2 text-xs text-[#e0556c]"
        >
          {notice}
        </p>
      )}
    </section>
  );
}
