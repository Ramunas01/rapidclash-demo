import moveUrl from '../assets/sounds/move.wav';
import playUrl from '../assets/sounds/play.mp3';
import diceRollUrl from '../assets/sounds/dice-roll.mp3';
import diceWinUrl from '../assets/sounds/dice-win.mp3';
import rejectUrl from '../assets/sounds/reject.wav';
import minesGemUrl from '../assets/sounds/mines-gem.mp3';
import minesMineUrl from '../assets/sounds/mines-mine.mp3';
import blackjackCardDealUrl from '../assets/sounds/blackjack-card-deal.mp3';
import blackjackCardFlipUrl from '../assets/sounds/blackjack-card-flip.mp3';
import coinflipCoinSpinUrl from '../assets/sounds/coinflip-coin-spin.mp3';
import genericWinUrl from '../assets/sounds/generic-win.mp3';
import chessPieceMoveUrl from '../assets/sounds/chess-piece-move.mp3';

/**
 * Minimal, dependency-free Web Audio wrapper for short UI sound effects.
 *
 * Design goals for the demo:
 *  - iOS/mobile autoplay is blocked until a user gesture resumes an AudioContext.
 *    `unlock()` (called from the first tap/click/keydown, and from PLAY) fixes that.
 *  - Every playback path FAILS SILENTLY — no audio support, not yet unlocked, muted,
 *    or the buffer isn't decoded yet must never throw or interrupt gameplay.
 *  - The mute preference is PERSISTED in localStorage (default = sound ON).
 *  - Adding a sound = one line in MANIFEST (import its URL, map a name to it).
 */

/** name -> asset URL (Vite resolves the import to a URL string). Add clips here. */
const MANIFEST: Record<string, string> = {
  // Generic placeholder clip — kept ONLY as `sound.test.ts`'s own stand-in name for exercising this
  // module's shared mechanics (mute, unlock, preload), unrelated to any one game. Ticket
  // 2026-10-04#4 (D80) gave Chess its own dedicated `chess-piece-move` entry below instead of
  // repointing this one — `move` had become Chess's de-facto move sound by being its only real
  // caller, but retiring this key outright would have meant updating every one of sound.test.ts's
  // own generic placeholder usages for no reason connected to that ticket's actual scope.
  move: moveUrl,
  play: playUrl,
  'dice-roll': diceRollUrl,
  'dice-win': diceWinUrl,
  // Ticket 2026-09-18#2 item 3: a deliberately minimal, genuinely subtle rejection cue — fired on
  // the 3 moments the app already recognizes as a rejected action (see App.tsx's onError, and
  // GameHub.tsx's guideToBet()/handlePlayFriend() call sites). Owner-approved: rejection-only, not
  // a success-click half — framed as a functional bug fix, not new sound design.
  reject: rejectUrl,
  // Ticket 2026-09-22#2 (D39): Designer-provided (not self-synthesized, same precedent as
  // play/dice-roll/dice-win) — fired on a SERVER-CONFIRMED tile reveal (see MinesBoard's own
  // round-scoped diff effect in MinesHub.tsx, not the tap itself). No pooling/preload-on-Play
  // code needed for either — this file's own buffer-source-per-call architecture already gives
  // every play() call an independent, fully-overlapping playback, and preloadSounds() already
  // decodes every MANIFEST entry uniformly on the first page-wide gesture, well before Mines is
  // ever reached.
  'mines-gem': minesGemUrl,
  'mines-mine': minesMineUrl,
  // Ticket 2026-10-01#4 (D72): Designer-provided, same precedent as mines-gem/mines-mine — fired
  // from BlackjackHub.tsx's BlackjackBoard on each card's own landing (deal) / the hole card's
  // flip (see those call sites for the double-fire guard reasoning). No pooling/preload-on-entry
  // code needed here either — preloadSounds() already decodes every MANIFEST entry uniformly
  // ahead of any hub being reached, and play() mints an independent source node per call, so
  // overlapping deal sounds during the opening stagger layer cleanly with no restart/interruption.
  'blackjack-card-deal': blackjackCardDealUrl,
  'blackjack-card-flip': blackjackCardFlipUrl,
  // Ticket 2026-10-04#3 (D79): Designer-provided, same precedent as the entries above. Coin spin
  // fires once per real flip (Coin.tsx's own flip-kickoff effect, Coinflip-only call site); generic
  // win fires on the shared OwnSlot win-fill's first frame, gated per-game via a new `winSoundName`
  // prop (see GameHub.tsx/slotReveal.tsx) — NOT wired unconditionally into the shared win-reveal
  // hook itself, since Blackjack already consumes that same mechanism and must stay silent on it.
  // Ticket 2026-10-04#4 (D80) extended the `winSoundName` gate to Chess too (same mechanism, same
  // key — see GameHub.tsx's own ternary). No preload code needed for either — same reasoning as
  // every entry above, preloadSounds() already decodes this whole manifest uniformly on the first
  // page-wide gesture.
  'coinflip-coin-spin': coinflipCoinSpinUrl,
  'generic-win': genericWinUrl,
  // Ticket 2026-10-04#4 (D80): Chess's own dedicated move-sound clip — repoints ChessHub.tsx's
  // existing play() call site (previously the generic `move` key above) to a name that actually
  // matches what it plays, following the same per-sound-name convention every other entry here
  // uses. The trigger itself (a FEN-change watcher) is unchanged — this ticket is an asset swap,
  // not a retrigger (see ChessHub.tsx's own doc comment on that effect).
  'chess-piece-move': chessPieceMoveUrl,
};

export type SoundName = keyof typeof MANIFEST | string;

const MUTE_KEY = 'rc:sound:muted';

type WindowWithWebkitAudio = Window & { webkitAudioContext?: typeof AudioContext };

function AudioCtor(): typeof AudioContext | null {
  if (typeof window === 'undefined') return null;
  return window.AudioContext ?? (window as WindowWithWebkitAudio).webkitAudioContext ?? null;
}

let ctx: AudioContext | null = null;
const buffers = new Map<string, AudioBuffer>();
let preloaded = false;

// Mute: read the durable pref once, keep an in-memory mirror in sync with it.
function readMutedPref(): boolean {
  try {
    return window.localStorage.getItem(MUTE_KEY) === '1';
  } catch {
    return false;
  }
}
let muted = typeof window !== 'undefined' ? readMutedPref() : false;

const listeners = new Set<() => void>();
function notify() {
  for (const fn of listeners) {
    try {
      fn();
    } catch {
      /* a listener error must not break others */
    }
  }
}

/** Subscribe to mute-state changes (e.g. a toggle button re-render). Returns an unsubscribe. */
export function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function isMuted(): boolean {
  return muted;
}

export function setMuted(next: boolean): void {
  muted = next;
  try {
    window.localStorage.setItem(MUTE_KEY, next ? '1' : '0');
  } catch {
    /* localStorage may be unavailable — keep the in-memory state anyway */
  }
  notify();
}

export function toggleMute(): void {
  setMuted(!muted);
}

/** Lazily create the AudioContext. Returns null if Web Audio is unsupported. */
function ensureContext(): AudioContext | null {
  if (ctx) return ctx;
  const Ctor = AudioCtor();
  if (!Ctor) return null;
  try {
    ctx = new Ctor();
    // Ticket 2026-09-30#1 item 2: the 2026-09-22#6 visibilitychange listener only catches
    // screen-lock/backgrounding — it never fires for a hardware mute-switch toggle, since that
    // doesn't hide/background the page. iOS/WebKit can suspend/interrupt the AudioContext for
    // other OS-level audio-session reasons too. Listening to the context's own state directly
    // catches all of them, not just the one proxy signal visibilitychange represents.
    ctx.onstatechange = () => {
      if (ctx?.state !== 'running') unlock();
    };
  } catch {
    ctx = null;
    return null;
  }
  return ctx;
}

/** Fetch + decode every manifest asset into an AudioBuffer. Fails silently per asset. */
export async function preloadSounds(): Promise<void> {
  if (preloaded) return;
  const context = ctx ?? ensureContext();
  if (!context) return;
  preloaded = true;
  await Promise.all(
    Object.entries(MANIFEST).map(async ([name, url]) => {
      try {
        const res = await fetch(url);
        const data = await res.arrayBuffer();
        const buf = await context.decodeAudioData(data);
        buffers.set(name, buf);
      } catch {
        /* a missing/undecodable clip just stays silent */
      }
    }),
  );
}

/**
 * Create/resume the AudioContext on a user gesture. THE critical mobile-autoplay fix.
 * Idempotent and safe to call repeatedly (tap/click/keydown/PLAY).
 */
export function unlock(): void {
  const context = ensureContext();
  if (!context) return;
  void preloadSounds();
  // Ticket 2026-10-07#2 (D89): resume from ANY non-running, non-closed state — not just 'suspended'.
  // WebKit adds a non-standard 'interrupted' state (audio-session interruptions: a call, Siri,
  // another app taking the session) that the old `=== 'suspended'` check skipped entirely, so
  // neither onstatechange nor a PLAY gesture could ever revive a context stuck there. (Typed as a
  // plain string since lib.dom's AudioContextState doesn't list 'interrupted'.)
  const state: string = context.state;
  if (state !== 'running' && state !== 'closed') {
    void context.resume().catch(() => {
      /* resume can reject if there was no real gesture — ignore */
    });
  }
}

/** Play a preloaded clip by manifest name. Silent no-op if unavailable/muted/unlocked/unloaded. */
export function play(name: SoundName): void {
  if (muted) return;
  const context = ctx;
  // Not unlocked yet (no context, or still suspended) → stay silent, never force autoplay.
  if (!context || context.state !== 'running') return;
  const buffer = buffers.get(name);
  if (!buffer) return;
  try {
    const src = context.createBufferSource();
    src.buffer = buffer;
    src.connect(context.destination);
    src.start(0);
  } catch {
    /* a failed playback must never throw into the render/gesture path */
  }
}

let unlockInstalled = false;
/**
 * Install a one-time global gesture listener that unlocks audio on the first
 * pointerdown/keydown, then removes itself. Idempotent — safe to call from many mounts.
 */
export function installUnlockOnFirstGesture(): void {
  if (unlockInstalled || typeof window === 'undefined') return;
  unlockInstalled = true;
  const handler = () => {
    unlock();
    window.removeEventListener('pointerdown', handler);
    window.removeEventListener('keydown', handler);
  };
  window.addEventListener('pointerdown', handler, { once: false });
  window.addEventListener('keydown', handler, { once: false });
  // Ticket 2026-09-22#6: the gesture listener above fires ONCE, ever, then removes itself — but a
  // mobile browser routinely SUSPENDS the AudioContext again later (screen lock, backgrounding),
  // and nothing was left listening to revive it. play() correctly stays silent on a suspended
  // context (never force autoplay) — so once suspended a second time, sound went permanently dead
  // for the rest of that session, with no tap/PLAY/tile-reveal able to bring it back. The browser's
  // gesture requirement only applies to a context's FIRST-EVER resume() — once genuinely unlocked
  // by a real gesture (already guaranteed above), later resume() calls from a non-gesture context
  // like this listener are standardly permitted. unlock() is already idempotent/safe to call
  // repeatedly, so this is a permanent listener (unlike the gesture one, never removed).
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') unlock();
  });
}
