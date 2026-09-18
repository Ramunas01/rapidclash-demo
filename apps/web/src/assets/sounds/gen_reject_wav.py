#!/usr/bin/env python3
"""Generate reject.wav — a short, quiet, low-frequency "blip" for a rejected action.

Self-authored, CC0 (public domain), same approach as gen_move_wav.py (no external
samples, no licensing concern). Re-run to regenerate the asset:

    python3 gen_reject_wav.py

Ticket 2026-09-18#2 item 3: a deliberately minimal, genuinely subtle cue for the
three moments the app already recognizes as a rejected action (a failed JOIN, PLAY
with no bet armed, "Play a Friend" pressed) — framed as a functional bug fix, not
new sound design. "Quiet" is baked into the synthesis amplitude itself: `play()`
has no separate volume/gain control, so the low peak amplitude below IS the only
place "quiet" can actually live.

Output: reject.wav — mono, 16-bit PCM, 22050 Hz, ~130 ms (a few KB).
Character: a low (~110 Hz) sine with a moderate exponential amplitude decay, no
noise transient (a soft blip, not move.wav's percussive "knock") — low peak
amplitude (0.22 vs move.wav's 0.8) is what keeps it genuinely subtle, not a
different waveform shape.
"""
import math
import struct
import wave

SAMPLE_RATE = 22050
DURATION_S = 0.13          # ~130 ms
TONE_HZ = 110.0            # low blip, distinct from move.wav's 180 Hz knock
DECAY = 18.0               # gentler decay than move.wav's 42 — a soft fade, not a snap
PEAK = 0.22                # deliberately quiet — the only "volume control" play() has

n = int(SAMPLE_RATE * DURATION_S)
samples = []
for i in range(n):
    t = i / SAMPLE_RATE
    env = math.exp(-DECAY * t)
    body = math.sin(2.0 * math.pi * TONE_HZ * t)
    val = PEAK * body * env
    val = max(-1.0, min(1.0, val))
    samples.append(int(val * 32767))

with wave.open("reject.wav", "w") as w:
    w.setnchannels(1)
    w.setsampwidth(2)
    w.setframerate(SAMPLE_RATE)
    w.writeframes(b"".join(struct.pack("<h", s) for s in samples))

print(f"wrote reject.wav: {n} frames, {n * 2 + 44} bytes")
