import moveUrl from '../assets/sounds/move.wav';
import playUrl from '../assets/sounds/play.mp3';
import diceRollUrl from '../assets/sounds/dice-roll.mp3';
import diceWinUrl from '../assets/sounds/dice-win.mp3';
import rejectUrl from '../assets/sounds/reject.wav';

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
  move: moveUrl,
  play: playUrl,
  'dice-roll': diceRollUrl,
  'dice-win': diceWinUrl,
  // Ticket 2026-09-18#2 item 3: a deliberately minimal, genuinely subtle rejection cue — fired on
  // the 3 moments the app already recognizes as a rejected action (see App.tsx's onError, and
  // GameHub.tsx's guideToBet()/handlePlayFriend() call sites). Owner-approved: rejection-only, not
  // a success-click half — framed as a functional bug fix, not new sound design.
  reject: rejectUrl,
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
  if (context.state === 'suspended') {
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
}
