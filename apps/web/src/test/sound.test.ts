// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * jsdom has no Web Audio — mock AudioContext (mirrors how the hub tests mock canvas-confetti).
 * A shared `startSpy` records every BufferSource.start() so we can assert WHEN sound actually
 * plays (only after unlock, never when muted).
 */
const startSpy = vi.fn();
/** Ticket 2026-09-22#6: captures the one AudioContext instance sound.ts creates, so a test can
 *  flip it back to 'suspended' (simulating a mobile browser re-suspending after screen lock/
 *  backgrounding) and confirm a later visibilitychange revives it. */
let lastCtx: FakeAudioContext | undefined;

/** Captures the created instance into `lastCtx` — a plain function call, not a `this`-alias. */
function captureInstance(instance: FakeAudioContext): void {
  lastCtx = instance;
}

class FakeAudioContext {
  // 'interrupted' is WebKit's non-standard audio-session state (ticket 2026-10-07#2, D89).
  state: 'suspended' | 'running' | 'closed' | 'interrupted' = 'suspended';
  destination = {} as AudioDestinationNode;
  onstatechange: ((ev: Event) => void) | null = null;
  // D89 follow-up (2026-10-08#1): a controllable audio clock + close(), for stall detection.
  currentTime = 0;
  close = vi.fn(async () => {
    this.state = 'closed';
  });
  resume = vi.fn(async () => {
    this.state = 'running'; // set synchronously so play() sees 'running' right after unlock()
  });
  decodeAudioData = vi.fn(async () => ({ duration: 0.1 }) as AudioBuffer);
  constructor() {
    captureInstance(this);
  }
  createBufferSource() {
    return {
      buffer: null as AudioBuffer | null,
      connect: vi.fn(),
      start: startSpy,
    } as unknown as AudioBufferSourceNode;
  }
}

/** Import a FRESH copy of the module (module-level ctx/buffers/muted are singletons). */
async function freshSound() {
  vi.resetModules();
  return import('../lib/sound.js');
}

beforeEach(() => {
  startSpy.mockClear();
  lastCtx = undefined;
  vi.stubGlobal('AudioContext', FakeAudioContext as unknown as typeof AudioContext);
  // Preload fetches each manifest asset URL → give it a decodable ArrayBuffer.
  vi.stubGlobal('fetch', vi.fn(async () => ({ arrayBuffer: async () => new ArrayBuffer(8) }) as Response));
  window.localStorage.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
  window.localStorage.clear();
});

describe('sound module', () => {
  it('autoplay-unlock: play() is silent until unlock() resumes the context, then a BufferSource starts', async () => {
    const sound = await freshSound();
    await sound.preloadSounds(); // decode buffers; context created but still suspended

    sound.play('move');
    expect(startSpy).not.toHaveBeenCalled(); // suspended (autoplay-blocked) → no sound

    sound.unlock(); // the critical mobile-autoplay fix → context resumes to 'running'
    sound.play('move');
    expect(startSpy).toHaveBeenCalledTimes(1); // now it actually plays
  });

  it('a missing/unknown clip name never plays and never throws', async () => {
    const sound = await freshSound();
    await sound.preloadSounds();
    sound.unlock();
    expect(() => sound.play('does-not-exist')).not.toThrow();
    expect(startSpy).not.toHaveBeenCalled();
  });

  it('mute silences all sound and persists to localStorage', async () => {
    const sound = await freshSound();
    await sound.preloadSounds();
    sound.unlock();

    expect(sound.isMuted()).toBe(false); // default = sound ON for the demo
    sound.setMuted(true);
    expect(sound.isMuted()).toBe(true);
    expect(window.localStorage.getItem('rc:sound:muted')).toBe('1');

    sound.play('move');
    expect(startSpy).not.toHaveBeenCalled(); // muted → nothing plays

    sound.setMuted(false);
    sound.play('move');
    expect(startSpy).toHaveBeenCalledTimes(1); // unmuting restores sound
  });

  it('a fresh module init respects the PERSISTED mute preference', async () => {
    window.localStorage.setItem('rc:sound:muted', '1');
    const sound = await freshSound(); // reads the durable pref on init
    expect(sound.isMuted()).toBe(true);

    await sound.preloadSounds();
    sound.unlock();
    sound.play('move');
    expect(startSpy).not.toHaveBeenCalled(); // still muted from the persisted pref
  });

  it('toggleMute flips state and notifies subscribers', async () => {
    const sound = await freshSound();
    const listener = vi.fn();
    const unsub = sound.subscribe(listener);

    sound.toggleMute();
    expect(sound.isMuted()).toBe(true);
    expect(listener).toHaveBeenCalledTimes(1);

    unsub();
    sound.toggleMute();
    expect(listener).toHaveBeenCalledTimes(1); // unsubscribed → no further notifications
  });

  // Ticket 2026-09-22#6: the one-time gesture listener that unlocks audio removes itself after
  // firing once — a mobile browser routinely suspends the AudioContext again later (screen lock,
  // backgrounding), and nothing was left listening to revive it, permanently silencing sound for
  // the rest of that session. Fix: a visibilitychange listener that re-unlocks on return to
  // foreground, installed once alongside the gesture listener.
  describe('visibilitychange re-unlock (ticket 2026-09-22#6)', () => {
    it('a context re-suspended after the initial unlock is revived when the tab becomes visible again', async () => {
      const sound = await freshSound();
      await sound.preloadSounds();
      sound.installUnlockOnFirstGesture();

      window.dispatchEvent(new Event('pointerdown')); // the initial real-gesture unlock
      expect(lastCtx?.state).toBe('running');

      sound.play('move');
      expect(startSpy).toHaveBeenCalledTimes(1);

      // Simulate a mobile browser suspending the context again (screen lock/backgrounding) — no
      // gesture listener left to revive it (it already removed itself).
      lastCtx!.state = 'suspended';
      sound.play('move');
      expect(startSpy).toHaveBeenCalledTimes(1); // still just the one — correctly silent while suspended

      Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
      document.dispatchEvent(new Event('visibilitychange'));
      await Promise.resolve(); // let the (async) resume() microtask settle

      expect(lastCtx?.state).toBe('running');
      sound.play('move');
      expect(startSpy).toHaveBeenCalledTimes(2); // revived — sound works again without any new tap
    });

    it('a visibilitychange to hidden does not attempt to resume', async () => {
      const sound = await freshSound();
      await sound.preloadSounds();
      sound.installUnlockOnFirstGesture();
      window.dispatchEvent(new Event('pointerdown'));
      const resumeCalls = lastCtx!.resume.mock.calls.length;

      Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
      document.dispatchEvent(new Event('visibilitychange'));

      expect(lastCtx!.resume.mock.calls.length).toBe(resumeCalls); // unchanged — no extra resume() attempt
    });
  });

  // Ticket 2026-09-30#1 item 2: visibilitychange only catches screen-lock/backgrounding — a
  // hardware mute-switch toggle doesn't hide/background the page, so it never fires
  // visibilitychange, yet iOS/WebKit can still suspend/interrupt the AudioContext for it. Fix:
  // listen to the context's own onstatechange directly, alongside (not instead of) visibilitychange.
  describe('onstatechange re-unlock (ticket 2026-09-30#1 item 2)', () => {
    it('a context suspended for a reason other than visibilitychange is revived via onstatechange', async () => {
      const sound = await freshSound();
      await sound.preloadSounds();
      sound.installUnlockOnFirstGesture();

      window.dispatchEvent(new Event('pointerdown')); // the initial real-gesture unlock
      expect(lastCtx?.state).toBe('running');

      sound.play('move');
      expect(startSpy).toHaveBeenCalledTimes(1);

      // Simulate an OS-level audio-session suspension (e.g. a hardware mute-switch toggle) that
      // never fires visibilitychange — only the context's own state actually changes.
      lastCtx!.state = 'suspended';
      lastCtx!.onstatechange?.(new Event('statechange'));
      await Promise.resolve(); // let the (async) resume() microtask settle

      expect(lastCtx?.state).toBe('running');
      sound.play('move');
      expect(startSpy).toHaveBeenCalledTimes(2); // revived — no visibilitychange or new gesture needed
    });

    it('onstatechange firing while already running does not attempt a redundant resume', async () => {
      const sound = await freshSound();
      await sound.preloadSounds();
      sound.installUnlockOnFirstGesture();
      window.dispatchEvent(new Event('pointerdown'));
      const resumeCalls = lastCtx!.resume.mock.calls.length;

      lastCtx!.onstatechange?.(new Event('statechange')); // still 'running' — nothing to revive

      expect(lastCtx!.resume.mock.calls.length).toBe(resumeCalls); // unchanged — no extra resume() attempt
    });
  });

  // Ticket 2026-10-07#2 (D89): unlock() used to resume ONLY from 'suspended', so a context stuck in
  // WebKit's 'interrupted' audio-session state could never be revived — not by onstatechange, not by
  // a later gesture (PLAY now re-unlocks — see GameHub.tsx's handlePlayPress).
  describe("non-'suspended' dead states (ticket 2026-10-07#2, D89)", () => {
    it("a context stuck in WebKit's 'interrupted' state is revived by the next unlock() (e.g. a PLAY press)", async () => {
      const sound = await freshSound();
      await sound.preloadSounds();
      sound.unlock();
      expect(lastCtx?.state).toBe('running');

      lastCtx!.state = 'interrupted'; // a call / Siri / another app took the audio session
      sound.play('move');
      expect(startSpy).not.toHaveBeenCalled(); // play() correctly stays silent while not running

      sound.unlock();
      await Promise.resolve();
      expect(lastCtx?.state).toBe('running');
      sound.play('move');
      expect(startSpy).toHaveBeenCalledTimes(1);
    });

    it("onstatechange into 'interrupted' attempts a resume (it used to be skipped)", async () => {
      const sound = await freshSound();
      await sound.preloadSounds();
      sound.unlock();
      const resumeCalls = lastCtx!.resume.mock.calls.length;

      lastCtx!.state = 'interrupted';
      lastCtx!.onstatechange?.(new Event('statechange'));

      expect(lastCtx!.resume.mock.calls.length).toBe(resumeCalls + 1);
    });

    it("a 'closed' context is never resumed (resume() on a closed context always rejects)", async () => {
      const sound = await freshSound();
      await sound.preloadSounds();
      sound.unlock();
      const resumeCalls = lastCtx!.resume.mock.calls.length;

      lastCtx!.state = 'closed';
      sound.unlock();

      expect(lastCtx!.resume.mock.calls.length).toBe(resumeCalls);
    });
  });

  // Ticket 2026-10-08#1 (D89 follow-up): on iOS the context can report 'running' while its output
  // is dead (Owner's on-device test: after a screen lock, only backgrounding the browser restored
  // sound). A 'running' context whose clock has stopped is recreated; decoded buffers are reused.
  describe('stalled-clock recovery (ticket 2026-10-08#1)', () => {
    let nowMs = 0;
    beforeEach(() => {
      nowMs = 0;
      vi.spyOn(performance, 'now').mockImplementation(() => nowMs);
    });
    afterEach(() => vi.restoreAllMocks());

    it("a 'running' context whose clock froze is closed and replaced; the replacement plays a buffer decoded by the OLD context", async () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const sound = await freshSound();
      await sound.preloadSounds();
      sound.unlock(); // resumes → running
      const dead = lastCtx!;
      sound.unlock(); // first running observation → baseline only, never judged
      expect(dead.close).not.toHaveBeenCalled();

      nowMs += 5000; // 5s of wall time pass, but the clock is frozen at 0 (dead output)
      sound.unlock(); // e.g. the next PLAY press
      await Promise.resolve();

      expect(dead.close).toHaveBeenCalledTimes(1);
      const fresh = lastCtx!;
      expect(fresh).not.toBe(dead); // a brand-new AudioContext was constructed
      expect(fresh.resume).toHaveBeenCalled();
      expect(fresh.state).toBe('running');
      expect(dead.onstatechange).toBeNull(); // the old one's 'closed' transition can't re-enter unlock()
      expect(warn).toHaveBeenCalledTimes(1);

      // Reuse, not re-fetch: nothing was decoded on the new context, yet play() works on it.
      expect(fresh.decodeAudioData).not.toHaveBeenCalled();
      sound.play('move');
      expect(startSpy).toHaveBeenCalledTimes(1);
    });

    it('a healthy context whose clock keeps pace with wall time is never recreated', async () => {
      const sound = await freshSound();
      await sound.preloadSounds();
      sound.unlock();
      const ctx = lastCtx!;
      sound.unlock(); // baseline
      for (let i = 0; i < 3; i++) {
        nowMs += 5000;
        ctx.currentTime += 5;
        sound.unlock();
      }
      expect(ctx.close).not.toHaveBeenCalled();
      expect(lastCtx).toBe(ctx);
    });

    it('a legitimate suspend → resume (clock stopped while suspended) is NOT read as a stall', async () => {
      const sound = await freshSound();
      await sound.preloadSounds();
      sound.unlock();
      const ctx = lastCtx!;
      sound.unlock(); // baseline at t=0, clock 0

      // Screen locks: the context suspends for 30s and its clock stops, as it should.
      ctx.state = 'suspended';
      ctx.onstatechange?.(new Event('statechange')); // re-baseline (cleared) + auto-resume attempt
      await Promise.resolve();
      nowMs += 30_000;
      // The resume lands; the clock picks up where it stopped.
      ctx.onstatechange?.(new Event('statechange')); // now 'running' → baseline from here
      nowMs += 2000;
      ctx.currentTime += 2;
      sound.unlock(); // PLAY after unlocking the phone — healthy

      expect(ctx.close).not.toHaveBeenCalled();
      expect(lastCtx).toBe(ctx);
    });

    it("Owner's case — resumed after a screen lock but dead: the FIRST PLAY afterwards already recovers it", async () => {
      vi.spyOn(console, 'warn').mockImplementation(() => {});
      const sound = await freshSound();
      await sound.preloadSounds();
      sound.unlock();
      const dead = lastCtx!;
      dead.state = 'suspended'; // screen lock
      dead.onstatechange?.(new Event('statechange'));
      await Promise.resolve(); // auto-resume lands → 'running' again…
      dead.onstatechange?.(new Event('statechange')); // …and the 'running' transition baselines the clock
      nowMs += 3000; // …but output is dead: the clock never moves again
      sound.unlock(); // the very first PLAY press after unlocking the phone
      expect(dead.close).toHaveBeenCalledTimes(1);
      expect(lastCtx).not.toBe(dead);
    });

    it('a brand-new context is never judged on its first running observation, however late it comes', async () => {
      const sound = await freshSound();
      sound.unlock(); // created + resumed
      const ctx = lastCtx!;
      nowMs += 60_000; // long gap, clock still 0 — but no baseline exists yet
      sound.unlock();
      expect(ctx.close).not.toHaveBeenCalled();
      expect(lastCtx).toBe(ctx);
    });
  });
});
