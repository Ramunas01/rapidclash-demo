import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import rivalBg from '../../assets/bring-a-rival/rival-bg-live.png';
import trophyCoins from '../../assets/bring-a-rival/trophy-coins.png';
import arrowRightBold from '../../assets/bring-a-rival/arrow-right-bold.png';

const RIVAL_LINK = 'https://rapidclash.com';
const SUCCESS_TEXT = 'Link copied to clipboard';
const FALLBACK_TEXT = 'Copy failed — link: rapidclash.com';

// ~150ms fade in, ~2s hold (this is that hold, measured from fully faded-in), ~150ms fade out
// (the fade-out is the exit transition below, played automatically once toast goes null).
const TOAST_HOLD_MS = 2000;
const TOAST_FADE_MS = 0.15;

/**
 * "Bring a Rival" promo banner — the Designer's final export (docs/COMMS/from-advisor/
 * bring-a-rival-banner.md), copied byte-for-byte: no re-implementation, no Tailwind
 * conversion, no DOM restructuring. The only changes from the export are (1) asset URLs →
 * imported ES modules, (2) `.rc-banner-wrap`'s width: 390px → 100% (bounded by the max-w-md
 * hub body it renders full-bleed into — see GameHub.tsx's "pad internally" note), and (3) the
 * `id="bring-a-rival-cta"` hook the Designer's brief authorized for wiring the click handler.
 *
 * The CTA is a plain, non-focusable `<div>` — exactly as exported. This is a deliberate,
 * Owner-confirmed call (issue #301): no `role="button"`, no `tabIndex`, no keyboard handling.
 * Don't "fix" this without another explicit Owner sign-off.
 *
 * Shared by the Home hub and every Game hub.
 */
export function BringARival() {
  const [toast, setToast] = useState<string | null>(null);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (hideTimer.current) clearTimeout(hideTimer.current);
  }, []);

  function showToast(text: string) {
    if (hideTimer.current) clearTimeout(hideTimer.current);
    setToast(text);
    hideTimer.current = setTimeout(() => {
      setToast(null);
      hideTimer.current = null;
    }, TOAST_HOLD_MS);
  }

  function handleCtaClick() {
    try {
      if (!navigator.clipboard?.writeText) throw new Error('clipboard API unavailable');
      // Must be called synchronously, with no prior await — Safari only honours the
      // clipboard permission inside the same tick as the user gesture.
      const write = navigator.clipboard.writeText(RIVAL_LINK);
      write.catch(() => showToast(FALLBACK_TEXT));
      showToast(SUCCESS_TEXT);
    } catch {
      showToast(FALLBACK_TEXT);
    }
  }

  return (
    <section data-testid="home-rival" aria-label="Bring a rival">
      <div className="rc-banner-wrap" style={{ width: '100%' }}>
        <div
          style={{
            margin: '26px 16px 0 16px',
            borderRadius: '24px',
            backgroundColor: '#4B2A80',
            backgroundImage: `url(${rivalBg})`,
            backgroundSize: '100% 100%',
            backgroundPosition: 'center',
            backgroundRepeat: 'no-repeat',
            boxShadow: '0 0 44px 8px rgba(139,69,240,0.26), 0 0 16px rgba(139,69,240,0.2)',
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            padding: '20px 16px 20px 18px',
            boxSizing: 'border-box',
          }}
        >
          <div style={{ flex: '1 1 auto', minWidth: 0 }}>
            <div
              style={{
                fontFamily: 'Arial, Helvetica, sans-serif',
                fontSize: '24px',
                lineHeight: '26px',
                fontWeight: 'bold',
                letterSpacing: '-0.5px',
                color: '#FFFFFF',
                textTransform: 'uppercase',
              }}
            >
              Bring a rival
            </div>
            <div
              style={{
                fontFamily: 'Arial, Helvetica, sans-serif',
                fontSize: '11px',
                lineHeight: '15px',
                color: '#FFFFFF',
                marginTop: '9px',
                whiteSpace: 'nowrap',
              }}
            >
              RapidClash is all about real<br />
              opponents. Send this to whoever<br />
              you want to take money from first.
            </div>
            <div
              id="bring-a-rival-cta"
              onClick={handleCtaClick}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '10px',
                marginTop: '14px',
                background: '#8B45F0',
                border: '3px solid #000000',
                borderRadius: '32px',
                padding: '11px 18px 11px 16px',
                cursor: 'pointer',
              }}
            >
              <span
                style={{
                  fontFamily: 'Arial, Helvetica, sans-serif',
                  fontSize: '12px',
                  fontWeight: 'bold',
                  letterSpacing: '0.3px',
                  color: '#FFFFFF',
                  textTransform: 'uppercase',
                  whiteSpace: 'nowrap',
                }}
              >
                Bring a rival
              </span>
              <img src={arrowRightBold} alt="" style={{ width: '20px', height: '15px', display: 'block' }} />
            </div>
          </div>
          <img
            src={trophyCoins}
            alt=""
            style={{ width: '134px', height: 'auto', display: 'block', flex: '0 0 134px', marginRight: '-8px' }}
          />
        </div>
      </div>

      <BringARivalToast text={toast} />
    </section>
  );
}

/**
 * Purpose-built pill toast (spec: docs/COMMS/from-advisor/bring-a-rival-banner.md §5) — the
 * repo's shadcn Toast scaffold (components/ui/toast.tsx) is unused/never-mounted and its shape
 * doesn't match this spec, so this is local state + framer-motion instead of wiring it up.
 * Fixed, centered, above HubToolbar's nav (z-20) and its height + safe-area-inset (see
 * HubToolbar.tsx's own env() pattern) so it never collides with the bottom nav.
 */
function BringARivalToast({ text }: { text: string | null }) {
  return (
    <div
      aria-live="polite"
      className="pointer-events-none fixed inset-x-0 z-30 flex justify-center px-4 bottom-[calc(2.75rem_+_0.75rem_+_env(safe-area-inset-bottom))]"
    >
      <AnimatePresence>
        {text && (
          <motion.div
            key="bring-a-rival-toast"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: TOAST_FADE_MS }}
            className="whitespace-nowrap rounded-full bg-surface px-5 py-2.5 text-[13px] font-semibold text-white"
          >
            {text}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
