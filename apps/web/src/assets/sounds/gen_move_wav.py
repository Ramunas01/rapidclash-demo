#!/usr/bin/env python3
"""Generate move.wav — a short wood "thump"/knock for the chess move sound.

Self-authored, CC0 (public domain). No external samples, no licensing concern:
the waveform is synthesised from scratch here. Re-run to regenerate the asset:

    python3 gen_move_wav.py

Output: move.wav — mono, 16-bit PCM, 22050 Hz, ~100 ms (a few KB).
Character: a low-ish decaying sine (~180 Hz) with a fast exponential amplitude
decay, plus a tiny noise transient at the attack for a "wood knock" feel.
"""
import math
import random
import struct
import wave

SAMPLE_RATE = 22050
DURATION_S = 0.10          # ~100 ms
TONE_HZ = 180.0            # low-ish body
DECAY = 42.0              # fast exponential amplitude decay
NOISE_MS = 6.0            # short attack transient
random.seed(1234)          # deterministic asset

n = int(SAMPLE_RATE * DURATION_S)
noise_n = int(SAMPLE_RATE * (NOISE_MS / 1000.0))
samples = []
for i in range(n):
    t = i / SAMPLE_RATE
    env = math.exp(-DECAY * t)                       # fast decay
    body = math.sin(2.0 * math.pi * TONE_HZ * t)
    # A little second harmonic gives the "knock" more wood, less pure-tone.
    body += 0.35 * math.sin(2.0 * math.pi * TONE_HZ * 2.0 * t)
    val = 0.8 * body * env
    if i < noise_n:                                  # attack transient
        transient_env = 1.0 - (i / noise_n)
        val += 0.5 * (random.uniform(-1.0, 1.0)) * transient_env
    val = max(-1.0, min(1.0, val))
    samples.append(int(val * 32767))

with wave.open("move.wav", "w") as w:
    w.setnchannels(1)
    w.setsampwidth(2)
    w.setframerate(SAMPLE_RATE)
    w.writeframes(b"".join(struct.pack("<h", s) for s in samples))

print(f"wrote move.wav: {n} frames, {n * 2 + 44} bytes")
