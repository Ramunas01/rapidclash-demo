import { useEffect, useMemo, useState } from 'react';
import { ChevronLeft } from 'lucide-react';
import type { AdminPlayerSummary, AdminPlayerLogResponse } from '@rapidclash/shared';
import { api } from '../api.js';

interface Props {
  token: string;
  onBack(): void;
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
 */
export function AdminScreen({ token, onBack }: Props) {
  const [players, setPlayers] = useState<AdminPlayerSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [sourceOnly, setSourceOnly] = useState(false);

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

  const shownPlayers = useMemo(
    () => (sourceOnly ? players.filter((p) => p.source) : players),
    [players, sourceOnly],
  );

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
                  {log.matches.map((m) => (
                    <tr key={m.matchId} data-testid={`admin-match-${m.matchId}`} className="border-b border-white/5">
                      <td className="py-1 pr-2">{m.gameId}</td>
                      <td className="py-1 pr-2">{m.opponent}</td>
                      <td className="py-1 pr-2">{m.result}</td>
                      <td className={`py-1 pr-2 ${m.amount > 0 ? 'text-green-400' : m.amount < 0 ? 'text-red-400' : ''}`}>
                        {m.amount > 0 ? '+' : ''}{m.amount}
                      </td>
                      <td className="py-1 pr-2">{m.runningBalance}</td>
                      <td className="py-1 pr-2 text-white/50">{new Date(m.createdAt).toLocaleString()}</td>
                    </tr>
                  ))}
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
                      {e.amount > 0 ? '+' : ''}{e.amount}
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
        <label className="flex items-center gap-2 text-xs text-white/60">
          <input
            type="checkbox"
            checked={sourceOnly}
            onChange={(e) => setSourceOnly(e.target.checked)}
            data-testid="admin-source-filter"
          />
          Demo-link only
        </label>
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
