import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { cn } from '@/lib/utils';
import { BOLT_PATH } from '../cards/CardBack.js';

/** Flip duration (s) — kept at the previous coin's reveal length so the timer/flow is unchanged. */
export const COIN_FLIP_DURATION_S = 1.1;

export type CoinFace = 'heads' | 'tails';

/**
 * Per-face flat palette — face disc / offset edge band / tone-on-tone bolt (the card-back treatment).
 * Token-driven (index.css `--coin-*`), never hardcoded hex: heads = orange, tails = the `--card-back`
 * brand blue so the coin and the card backs share one blue.
 */
export const COIN_FACE_TOKENS: Record<CoinFace, { face: string; edge: string; mark: string }> = {
  heads: { face: 'var(--coin-heads-face)', edge: 'var(--coin-heads-edge)', mark: 'var(--coin-heads-mark)' },
  tails: { face: 'var(--coin-tails-face)', edge: 'var(--coin-tails-edge)', mark: 'var(--coin-tails-mark)' },
};

/**
 * A flat vector coin — no gradient / glow / shadow; depth reads ONLY from an offset edge band. Reuses
 * the shared {@link BOLT_PATH} so one mark lives on the card backs AND both coin faces (swap that one
 * constant to change every mark). The flip is pure WIDTH geometry: the coin squashes on X to a thin
 * vertical sliver, the face + bolt swap colour at the midpoint (scaleX ≈ 0), then it grows back into
 * the opposite face — no rotateY/3D, no blur/gloss.
 *
 * `face` null → resting heads (no flip). `face` set → flip to that side (re-keyed, one-shot), mirroring
 * the old Coin contract so the board's terminal / draw-flip choreography is unchanged.
 */
export function FlatCoin({ face = null, size = 128, className }: { face?: CoinFace | null; size?: number; className?: string }) {
  const flipping = face != null;
  const target: CoinFace = face ?? 'heads';
  // The shown face lags a flip: it swaps to `target` at the geometric midpoint (scaleX ≈ 0), so the
  // colour change lands exactly when the coin is edge-on. Resting → heads immediately.
  const [displayFace, setDisplayFace] = useState<CoinFace>(target);
  useEffect(() => {
    if (!flipping) {
      setDisplayFace('heads');
      return;
    }
    const id = setTimeout(() => setDisplayFace(target), (COIN_FLIP_DURATION_S * 1000) / 2);
    return () => clearTimeout(id);
  }, [flipping, target]);

  const t = COIN_FACE_TOKENS[displayFace];
  return (
    <motion.div
      // Re-key on each flip so the one-shot squash restarts (matches the old coin's re-key behaviour).
      key={flipping ? `flip-${face}` : 'rest'}
      data-testid="coin-face"
      data-face={displayFace}
      aria-hidden="true"
      initial={flipping ? { scaleX: 1 } : false}
      animate={flipping ? { scaleX: [1, 0, 1] } : { scaleX: 1 }}
      transition={flipping ? { duration: COIN_FLIP_DURATION_S, times: [0, 0.5, 1], ease: 'easeInOut' } : { duration: 0.25 }}
      className={cn('block', className)}
      style={{ width: size, height: size }}
    >
      <svg viewBox="0 0 100 100" width={size} height={size} className="block h-full w-full">
        {/* Offset edge band — the ONLY depth cue: a darker disc peeking below-left of the face. */}
        <ellipse cx={46} cy={53} rx={38} ry={44} fill={t.edge} />
        {/* Face disc. */}
        <ellipse data-testid="coin-face-disc" cx={50} cy={50} rx={38} ry={44} fill={t.face} />
        {/* Tone-on-tone bolt (BOLT_PATH viewBox 0 0 24 24 → ×2, centred on the face; scales with it). */}
        <path data-testid="coin-face-bolt" d={BOLT_PATH} fill={t.mark} transform="translate(26 26) scale(2)" />
      </svg>
    </motion.div>
  );
}
