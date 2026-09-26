import { AnimatePresence, motion } from 'framer-motion';

/** T5's prototype-exact font override for "VS"/digit text (`GameHub.tsx`'s own `ARIAL` const,
 *  mirrored here rather than imported — this shared component must not reach into `GameHub.tsx`
 *  for a one-line string, same reasoning `RpsHub.tsx`'s own mirror already documented). */
const ARIAL = 'Arial, Helvetica, sans-serif';

/**
 * Digit-flip countdown — mirrors the prototype's `rcClockOut`/`rcClockIn` keyframe pair
 * (Full Spec.html:90-93). The outgoing digit slides down 26px, flashing through violet (#B285F7 at
 * the 45% mark, Full Spec.html:90) before fading out at #8B45F0, 240ms cubic-bezier(0.33,0,0.67,0.35)
 * (:90-91). The incoming digit slides up from -18px while fading in, 260ms
 * cubic-bezier(0.3,0.9,0.32,1) (:92-93). The prototype re-triggers this every tick by alternating
 * between two identical keyframe names (a CSS restart trick); Framer's keyed `AnimatePresence` gets
 * the same per-tick replay for free. Font: Full Spec.html:620-621 ('Space Grotesk', 26px, 700,
 * var(--rc-text)).
 *
 * Ticket 2026-09-26#2 (D61, ADVISOR_TO_PM.md): lifted out of `RpsHub.tsx` (was the private
 * `RpsCountdown`) so `CoinflipHub.tsx` can reuse the identical mechanism for its own pick-window
 * clock, rather than duplicating it — same pattern as `packages/shared/src/avatar.ts`'s own
 * extraction for ticket 2026-09-25#6. `testid` is a required prop (not defaulted) so each caller
 * states its own test id explicitly — RPS keeps `rps-countdown`, Coinflip keeps `coin-countdown`,
 * neither existing test needed to change id.
 */
export function DigitCountdown({ seconds, testid }: { seconds: number; testid: string }) {
  return (
    <div
      className="relative h-[26px] w-[52px] overflow-hidden"
      role="timer"
      aria-label={`${seconds} seconds to pick`}
      data-testid={testid}
    >
      <AnimatePresence initial={false}>
        <motion.span
          key={seconds}
          className="absolute inset-0 flex items-center justify-center font-bold leading-none tabular-nums"
          style={{ fontFamily: "'Space Grotesk', " + ARIAL, fontSize: 26, color: 'var(--rc-text)' }}
          initial={{ y: -18, opacity: 0 }}
          animate={{ y: 0, opacity: 1, transition: { duration: 0.26, ease: [0.3, 0.9, 0.32, 1] } }}
          exit={{
            y: 26,
            opacity: 0,
            color: ['var(--rc-text)', '#B285F7', '#8B45F0'],
            transition: { duration: 0.24, ease: [0.33, 0, 0.67, 0.35], times: [0, 0.45, 1] },
          }}
        >
          {seconds}
        </motion.span>
      </AnimatePresence>
    </div>
  );
}
