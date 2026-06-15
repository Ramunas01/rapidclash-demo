import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { Loader2, RotateCcw, Shield, Swords } from 'lucide-react';
import { formatClock } from '../format.js';

interface Props {
  /** The signed-in player's own alias (#34); null only on a legacy session pre-dating the field. */
  username: string | null;
  stake: number;
  /** Server-authoritative expiry of the owner's own resting bet (OC7); null until queue.waiting. */
  expiresAt: number | null;
  /** True once challenge.expired arrives — escrow is already refunded server-side. */
  expired: boolean;
  onRepost(): void;
  onLeave(): void;
}

export function LobbyScreen({ username, stake, expiresAt, expired, onRepost, onLeave }: Props) {
  // ONE client-side timer for the owner's countdown (no polling).
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  if (expired) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#0b0e18] px-4 text-center text-white">
        <motion.div
          initial={{ opacity: 0, y: 16, scale: 0.97 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ duration: 0.4 }}
          className="w-full max-w-sm rounded-2xl border border-white/10 bg-white/[0.03] p-8"
        >
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl border border-brand/30 bg-brand/10">
            <RotateCcw className="h-8 w-8 text-brand" />
          </div>
          <h1 className="text-2xl font-bold">Challenge expired</h1>
          <p className="mt-2 text-sm text-white/70">
            Your {stake}-credit stake was refunded automatically.
          </p>
          <button
            onClick={onRepost}
            data-testid="repost"
            className="mt-6 w-full rounded-xl bg-gradient-to-r from-brand to-indigo-600 py-3.5 text-base font-bold text-white shadow-lg shadow-brand/20 transition-all hover:to-indigo-500"
          >
            Re-post challenge
          </button>
          <button
            onClick={onLeave}
            className="mt-3 w-full rounded-xl border border-white/10 bg-white/5 py-3 text-sm font-medium text-white/80 transition-colors hover:bg-white/10"
          >
            Back
          </button>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-[#0b0e18] px-4 text-center text-white">
      <motion.div
        initial={{ opacity: 0, y: 16, scale: 0.97 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.4 }}
        className="w-full max-w-sm rounded-2xl border border-white/10 bg-white/[0.03] p-8"
      >
        {/* Pulsing brand halo behind the spinner. */}
        <div className="relative mx-auto mb-6 flex h-20 w-20 items-center justify-center">
          <span className="absolute inset-0 animate-ping rounded-full bg-brand/20" />
          <div className="relative flex h-20 w-20 items-center justify-center rounded-full border border-brand/30 bg-brand/10">
            <Swords className="h-9 w-9 text-brand" />
          </div>
        </div>

        <h1 className="text-2xl font-bold">Waiting for opponent…</h1>
        {username && (
          <p className="mt-1 text-sm text-white/60" data-testid="lobby-you">
            You (<strong className="text-white">{username}</strong>)
          </p>
        )}

        <div className="mt-5 inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-4 py-1.5">
          <span className="text-xs uppercase tracking-wide text-white/50">Stake</span>
          <span className="text-sm font-bold text-white">{stake} credits</span>
        </div>

        <div className="mt-6 flex items-center justify-center gap-2 text-white/40">
          <Loader2 className="h-4 w-4 animate-spin" />
          <span className="text-xs">Matching you with a live player…</span>
        </div>

        {expiresAt !== null && (
          <p
            className="mt-6 flex items-center justify-center gap-1.5 text-xs text-white/50"
            data-testid="owner-countdown"
          >
            <Shield className="h-3.5 w-3.5 text-emerald-400/80" />
            Your challenge expires in {formatClock(expiresAt - now)} and auto-refunds — no need to cancel.
          </p>
        )}

        <button
          onClick={onLeave}
          className="mt-6 w-full rounded-xl border border-white/10 bg-white/5 py-3 text-sm font-medium text-white/80 transition-colors hover:bg-white/10"
        >
          Leave Queue
        </button>
      </motion.div>
    </div>
  );
}
