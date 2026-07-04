// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * jsdom has no Web Audio — mock AudioContext (mirrors how the hub tests mock canvas-confetti).
 * A shared `startSpy` records every BufferSource.start() so we can assert WHEN sound actually
 * plays (only after unlock, never when muted).
 */
const startSpy = vi.fn();

class FakeAudioContext {
  state: 'suspended' | 'running' | 'closed' = 'suspended';
  destination = {} as AudioDestinationNode;
  resume = vi.fn(async () => {
    this.state = 'running'; // set synchronously so play() sees 'running' right after unlock()
  });
  decodeAudioData = vi.fn(async () => ({ duration: 0.1 }) as AudioBuffer);
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
});
