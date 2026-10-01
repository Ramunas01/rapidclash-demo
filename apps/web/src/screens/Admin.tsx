import { useEffect, useMemo, useState } from 'react';
import { ChevronLeft } from 'lucide-react';
import type { AdminMatchLogEntry, AdminPlayerSummary, AdminPlayerLogResponse, LedgerEntry } from '@rapidclash/shared';
import { api } from '../api.js';

interface Props {
  token: string;
  onBack(): void;
}

/** Ticket 2026-10-01#10, item 3: time-range filter options, each a fixed window ending now. 'all'
 *  (no filter) is the default, matching the same show-everything-unless-opted-in posture as the
 *  source/bot filters below. */
const TIME_RANGES = [
  { key: 'all', label: 'All time', ms: undefined },
  { key: '24h', label: 'Last 24h', ms: 24 * 60 * 60 * 1000 },
  { key: '7d', label: 'Last 7 days', ms: 7 * 24 * 60 * 60 * 1000 },
  { key: '30d', label: 'Last 30 days', ms: 30 * 24 * 60 * 60 * 1000 },
] as const;
type TimeRangeKey = (typeof TIME_RANGES)[number]['key'];

/** Ticket 2026-10-01#10, item 1: the same 🤖-prefix bot signal `match-history.ts`'s own
 *  `avatarFor`/`gateway.ts`'s `resolveAvatarId` already use — there's no separate `isBot` schema
 *  flag anywhere in this codebase, this prefix IS the bot signal. */
function isBotName(displayName: string): boolean {
  return displayName.startsWith('🤖');
}

/** Ticket 2026-10-01#10: amounts/balances are per-currency buckets, never implicitly USD — label
 *  every figure with its own currency code rather than a bare `$`. */
function withCurrency(amount: number, currency: string): string {
  return `${amount} ${currency}`;
}

/** Ticket 2026-10-02#1 (D76) — one row of the merged Matches-table timeline: either a real match
 *  or a standalone ledger event (no matchId) rendered inline at its real chronological position,
 *  so an admin can see WHY a balance jumped without separately opening the Ledger entries table
 *  and aligning timestamps by hand (the exact manual cross-reference Advisor's own DemoGM
 *  investigation did). */
type TimelineRow =
  | { kind: 'match'; key: string; data: AdminMatchLogEntry }
  | { kind: 'marker'; key: string; data: LedgerEntry };

const MARKER_LABELS: Record<string, string> = {
  OPENING_BALANCE: 'Account history compacted',
  ADMIN_CREDIT: 'Admin credit',
  REWARD_CLAIM: 'Reward claimed',
  GRANT: 'Starting grant',
};

/** Friendly label for a standalone ledger entry's own `type` — falls back to the raw type string
 *  for anything not in the map above, so an unrecognized/future entry type still renders instead
 *  of silently disappearing. */
function markerLabel(type: string): string {
  return MARKER_LABELS[type] ?? type;
}

/** Ticket 2026-10-02#1 (D76): merges `matches` with every STANDALONE ledger entry (any row with
 *  `matchId === null` — OPENING_BALANCE/ADMIN_CREDIT/REWARD_CLAIM/GRANT) into one chronological
 *  timeline. `matches` arrives newest-first (`getFullMatchLog`'s own convention);
 *  `ledgerEntries` arrives oldest-first (`AdminPlayerLogResponse`'s own doc comment) — both are
 *  walked here in a single oldest-first pass (a standard two-pointer merge, since each input is
 *  already sorted), then reversed once at the end to match the screen's own newest-first
 *  convention. A marker whose timestamp ties exactly with a match's own `createdAt` is placed
 *  BEFORE that match (`<=`), matching the real-world case this ticket was built from: a
 *  compaction checkpoint's own timestamp always strictly precedes the next match it's adjacent
 *  to, so this tie-break has no observable effect on real data — it only avoids an arbitrary
 *  ordering decision in the (currently impossible, since one settles via `ledger.settle` and the
 *  other via `compactOldTransactions`/`adminCredit`/`creditRewardClaim`, never the same
 *  transaction) case of an exact-same-millisecond tie. */
function buildMatchTimeline(matches: AdminMatchLogEntry[], ledgerEntries: LedgerEntry[]): TimelineRow[] {
  const chronoMatches = [...matches].reverse();
  const standalone = ledgerEntries
    .filter((e) => e.matchId == null)
    .slice()
    .sort((a, b) => (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0));

  const rows: TimelineRow[] = [];
  let si = 0;
  for (const m of chronoMatches) {
    while (si < standalone.length && standalone[si].createdAt <= m.createdAt) {
      rows.push({ kind: 'marker', key: `marker-${standalone[si].id}`, data: standalone[si] });
      si++;
    }
    rows.push({ kind: 'match', key: `match-${m.matchId}`, data: m });
  }
  while (si < standalone.length) {
    rows.push({ kind: 'marker', key: `marker-${standalone[si].id}`, data: standalone[si] });
    si++;
  }
  return rows.reverse();
}

/**
 * Ticket 2026-10-01#7 — a hidden (`?mode=admin`, App.tsx's own `isAdminModeUrl`), internal-only
 * view of demo-link investor traffic: who registered through which link, and what they did once
 * in (balance, games played, win/loss record, full ledger + match history). Reached only after a
 * genuine admin-role login — `requireAdmin` (server-side) is the real authorization boundary, this
 * screen is reachable client-side only when `role === 'admin'` on the signed-in session.
 *
 * Deliberately plain/utilitarian styling, not design-spec'd — this is an internal ops tool, not a
 * player-facing screen, so it doesn't follow the app's own --rc-* token system or hub chrome.
 *
 * Owner's own two resolved decisions (2026-10-01): hidden route over a nav entry; the list shows
 * EVERY account by default (not just source-tagged ones), with an explicit filter toggle.
 *
 * Ticket 2026-10-01#10 (D75) — Owner's first hands-on use surfaced 3 more filters (hide-bots,
 * last-seen column, time-range) plus a real bug (item 4, fixed in match-history.ts/admin.ts):
 * the detail log was silently USD-only, dropping every match a SOL-default player (the app-wide
 * default since D69) ever settled.
 */
export function AdminScreen({ token, onBack }: Props) {
  const [players, setPlayers] = useState<AdminPlayerSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [sourceOnly, setSourceOnly] = useState(false);
  const [hideBots, setHideBots] = useState(false);
  const [timeRange, setTimeRange] = useState<TimeRangeKey>('all');

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [log, setLog] = useState<AdminPlayerLogResponse | null>(null);
  const [logLoading, setLogLoading] = useState(false);
  const [logError, setLogError] = useState('');

  useEffect(() => {
    setLoading(true);
    api
      .adminPlayers(token)
      .then(setPlayers)
      .catch((e) => setError(e instanceof Error ? e.message : 'Error'))
      .finally(() => setLoading(false));
  }, [token]);

  useEffect(() => {
    if (!selectedId) return;
    setLog(null);
    setLogError('');
    setLogLoading(true);
    api
      .adminPlayerLog(selectedId, token)
      .then(setLog)
      .catch((e) => setLogError(e instanceof Error ? e.message : 'Error'))
      .finally(() => setLogLoading(false));
  }, [selectedId, token]);

  // Ticket 2026-10-01#10, item 1: filters compose with AND, not OR (Advisor's explicit
  // instruction) — e.g. "Demo-link only" + "Hide bots" together means source-tagged AND human.
  const shownPlayers = useMemo(() => {
    const rangeMs = TIME_RANGES.find((r) => r.key === timeRange)?.ms;
    return players.filter((p) => {
      if (sourceOnly && !p.source) return false;
      if (hideBots && isBotName(p.displayName)) return false;
      if (rangeMs !== undefined) {
        if (!p.lastSeenAt) return false;
        if (Date.now() - new Date(p.lastSeenAt).getTime() > rangeMs) return false;
      }
      return true;
    });
  }, [players, sourceOnly, hideBots, timeRange]);

  const selected = players.find((p) => p.playerId === selectedId);

  if (selectedId) {
    return (
      <div className="min-h-screen bg-[#0b0e18] p-4 text-sm text-white">
        <button
          type="button"
          onClick={() => setSelectedId(null)}
          aria-label="Back to player list"
          data-testid="admin-log-back"
          className="mb-4 flex items-center gap-1 text-white/60 hover:text-white"
        >
          <ChevronLeft className="h-4 w-4" /> Back to players
        </button>
        <h1 className="mb-1 text-lg font-bold" data-testid="admin-log-title">{selected?.displayName ?? selectedId}</h1>
        <p className="mb-4 text-xs text-white/50">
          source: {selected?.source ?? '—'} · balance: ${selected?.balance.toLocaleString('en-US') ?? '—'}
        </p>

        {logLoading && <p data-testid="admin-log-loading">Loading…</p>}
        {logError && <p role="alert" className="text-red-400" data-testid="admin-log-error">Couldn&apos;t load log: {logError}</p>}

        {log && (
          <>
            <h2 className="mb-2 mt-4 font-semibold">Matches ({log.matches.length})</h2>
            {log.matches.length === 0 ? (
              <p className="text-white/40" data-testid="admin-log-no-matches">No matches played yet.</p>
            ) : (
              <table className="w-full border-collapse text-left text-xs" data-testid="admin-log-matches">
                <thead>
                  <tr className="border-b border-white/10 text-white/50">
                    <th className="py-1 pr-2">Game</th>
                    <th className="py-1 pr-2">Opponent</th>
                    <th className="py-1 pr-2">Result</th>
                    <th className="py-1 pr-2">Amount</th>
                    <th className="py-1 pr-2">Balance after</th>
                    <th className="py-1 pr-2">When</th>
                  </tr>
                </thead>
                <tbody>
                  {buildMatchTimeline(log.matches, log.ledgerEntries).map((row) =>
                    row.kind === 'match' ? (
                      <tr key={row.key} data-testid={`admin-match-${row.data.matchId}`} className="border-b border-white/5">
                        <td className="py-1 pr-2">{row.data.gameId}</td>
                        <td className="py-1 pr-2">{row.data.opponent}</td>
                        <td className="py-1 pr-2">{row.data.result}</td>
                        <td className={`py-1 pr-2 ${row.data.amount > 0 ? 'text-green-400' : row.data.amount < 0 ? 'text-red-400' : ''}`}>
                          {row.data.amount > 0 ? '+' : ''}{withCurrency(row.data.amount, row.data.currency)}
                        </td>
                        <td className="py-1 pr-2">{withCurrency(row.data.runningBalance, row.data.currency)}</td>
                        <td className="py-1 pr-2 text-white/50">{new Date(row.data.createdAt).toLocaleString()}</td>
                      </tr>
                    ) : (
                      <tr key={row.key} data-testid={`admin-marker-${row.data.id}`} className="border-b border-white/5 bg-white/5 italic text-white/50">
                        <td className="py-1 pr-2" colSpan={5}>
                          {markerLabel(row.data.type)}: {row.data.amount > 0 ? '+' : ''}{withCurrency(row.data.amount, row.data.currency)}
                        </td>
                        <td className="py-1 pr-2">{new Date(row.data.createdAt).toLocaleString()}</td>
                      </tr>
                    ),
                  )}
                </tbody>
              </table>
            )}

            <h2 className="mb-2 mt-6 font-semibold">Ledger entries ({log.ledgerEntries.length})</h2>
            <table className="w-full border-collapse text-left text-xs" data-testid="admin-log-ledger">
              <thead>
                <tr className="border-b border-white/10 text-white/50">
                  <th className="py-1 pr-2">Type</th>
                  <th className="py-1 pr-2">Amount</th>
                  <th className="py-1 pr-2">Match</th>
                  <th className="py-1 pr-2">When</th>
                </tr>
              </thead>
              <tbody>
                {log.ledgerEntries.map((e) => (
                  <tr key={e.id} data-testid={`admin-ledger-${e.id}`} className="border-b border-white/5">
                    <td className="py-1 pr-2">{e.type}</td>
                    <td className={`py-1 pr-2 ${e.amount > 0 ? 'text-green-400' : e.amount < 0 ? 'text-red-400' : ''}`}>
                      {e.amount > 0 ? '+' : ''}{withCurrency(e.amount, e.currency)}
                    </td>
                    <td className="py-1 pr-2 text-white/50">{e.matchId ?? '—'}</td>
                    <td className="py-1 pr-2 text-white/50">{new Date(e.createdAt).toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0b0e18] p-4 text-sm text-white">
      <div className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onBack}
            aria-label="Back"
            data-testid="admin-back"
            className="flex h-9 w-9 items-center justify-center rounded-lg text-white/60 hover:bg-white/5 hover:text-white"
          >
            <ChevronLeft className="h-5 w-5" />
          </button>
          <h1 className="text-lg font-bold">Players</h1>
        </div>
        <div className="flex items-center gap-4 text-xs text-white/60">
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={sourceOnly}
              onChange={(e) => setSourceOnly(e.target.checked)}
              data-testid="admin-source-filter"
            />
            Demo-link only
          </label>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={hideBots}
              onChange={(e) => setHideBots(e.target.checked)}
              data-testid="admin-hide-bots-filter"
            />
            Hide bots
          </label>
          <label className="flex items-center gap-2">
            Last seen
            <select
              value={timeRange}
              onChange={(e) => setTimeRange(e.target.value as TimeRangeKey)}
              data-testid="admin-time-range"
              className="rounded bg-white/5 px-1 py-0.5 text-white"
            >
              {TIME_RANGES.map((r) => (
                <option key={r.key} value={r.key}>
                  {r.label}
                </option>
              ))}
            </select>
          </label>
        </div>
      </div>

      {loading && <p data-testid="admin-loading">Loading…</p>}
      {error && <p role="alert" className="text-red-400" data-testid="admin-error">Couldn&apos;t load players: {error}</p>}

      {!loading && !error && (
        <table className="w-full border-collapse text-left text-xs" data-testid="admin-players-table">
          <thead>
            <tr className="border-b border-white/10 text-white/50">
              <th className="py-1 pr-2">Username</th>
              <th className="py-1 pr-2">Source</th>
              <th className="py-1 pr-2">Balance</th>
              <th className="py-1 pr-2">Games</th>
              <th className="py-1 pr-2">W/L/D</th>
              <th className="py-1 pr-2">Won</th>
              <th className="py-1 pr-2">Lost</th>
              <th className="py-1 pr-2">Last seen</th>
            </tr>
          </thead>
          <tbody>
            {shownPlayers.map((p) => (
              <tr
                key={p.playerId}
                data-testid={`admin-player-${p.playerId}`}
                onClick={() => setSelectedId(p.playerId)}
                className="cursor-pointer border-b border-white/5 hover:bg-white/5"
              >
                <td className="py-1 pr-2">{p.displayName}</td>
                <td className="py-1 pr-2 text-white/50">{p.source ?? '—'}</td>
                <td className="py-1 pr-2">${p.balance.toLocaleString('en-US')}</td>
                <td className="py-1 pr-2">{p.gamesPlayed}</td>
                <td className="py-1 pr-2">{p.wins}/{p.losses}/{p.draws}</td>
                <td className="py-1 pr-2 text-green-400">{p.moneyWon}</td>
                <td className="py-1 pr-2 text-red-400">{p.moneyLost}</td>
                <td className="py-1 pr-2 text-white/50" data-testid={`admin-lastseen-${p.playerId}`}>
                  {p.lastSeenAt ? new Date(p.lastSeenAt).toLocaleString() : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {!loading && !error && shownPlayers.length === 0 && (
        <p className="text-white/40" data-testid="admin-no-players">No accounts match.</p>
      )}
    </div>
  );
}
