import pixelmatch from 'pixelmatch';
import { PNG } from 'pngjs';
import { DEVICE_SCALE_FACTOR } from './paths.js';
import type { MaskRect } from './screens.js';

/** Designer's fidelity gate (2026-09-09): a screen passes at ≤ 0.5% differing pixels. */
export const FIDELITY_GATE = 99.5;

export interface DiffResult {
  /** Fidelity as a percentage over the *unmasked* compared region: 100 = pixel-identical. */
  fidelity: number;
  pass: boolean;
  diffPixels: number;
  /** Pixels actually compared (region minus masked area). */
  scoredPixels: number;
  width: number;
  height: number;
  /** PNG buffer highlighting the differing pixels (masked regions shown flat grey). */
  diffImage: Buffer;
  maskedPixels: number;
  /** Set when the two inputs weren't the same size — the diff then covers the shared top-left region. */
  sizeMismatch?: { ref: string; app: string; comparedRegion: string };
}

function crop(img: PNG, w: number, h: number): PNG {
  if (img.width === w && img.height === h) return img;
  const out = new PNG({ width: w, height: h });
  PNG.bitblt(img, out, 0, 0, w, h, 0, 0);
  return out;
}

/** Paint a rect one flat colour in `img`. Rect is in device px. Returns pixels painted. */
function fillRect(img: PNG, x: number, y: number, w: number, h: number, rgb: [number, number, number]): number {
  const x0 = Math.max(0, x);
  const y0 = Math.max(0, y);
  const x1 = Math.min(img.width, x + w);
  const y1 = Math.min(img.height, y + h);
  let painted = 0;
  for (let py = y0; py < y1; py++) {
    for (let px = x0; px < x1; px++) {
      const i = (img.width * py + px) << 2;
      img.data[i] = rgb[0];
      img.data[i + 1] = rgb[1];
      img.data[i + 2] = rgb[2];
      img.data[i + 3] = 255;
      painted++;
    }
  }
  return painted;
}

/**
 * Compare two PNG buffers.
 *
 * - `threshold` is pixelmatch's per-pixel colour tolerance (0.1 default).
 * - `masks` are regions the Designer said to carry over from production unchanged (Q5) — they're
 *   filled identically in both images and excluded from the score.
 * - When the images differ in size (reference is chrome-clipped, app is full viewport), the diff
 *   covers the shared top-left window and the result is flagged; scroll-frame capture (Designer
 *   Q3) is the eventual fix.
 */
export function diffPng(refPng: Buffer, appPng: Buffer, masks: MaskRect[] = [], threshold = 0.1): DiffResult {
  const rawRef = PNG.sync.read(refPng);
  const rawApp = PNG.sync.read(appPng);

  const width = Math.min(rawRef.width, rawApp.width);
  const height = Math.min(rawRef.height, rawApp.height);
  const sized = rawRef.width !== rawApp.width || rawRef.height !== rawApp.height;

  const imgRef = crop(rawRef, width, height);
  const imgApp = crop(rawApp, width, height);

  let maskedPixels = 0;
  for (const m of masks) {
    const r: [number, number, number] = [128, 128, 128];
    const args = [m.x * DEVICE_SCALE_FACTOR, m.y * DEVICE_SCALE_FACTOR, m.w * DEVICE_SCALE_FACTOR, m.h * DEVICE_SCALE_FACTOR] as const;
    fillRect(imgRef, ...args, r);
    maskedPixels += fillRect(imgApp, ...args, r);
  }

  const diff = new PNG({ width, height });
  const diffPixels = pixelmatch(imgRef.data, imgApp.data, diff.data, width, height, { threshold, includeAA: false });
  const scoredPixels = width * height - maskedPixels;
  const fidelity = Math.round((1 - diffPixels / Math.max(1, scoredPixels)) * 10_000) / 100;

  return {
    fidelity,
    pass: fidelity >= FIDELITY_GATE,
    diffPixels,
    scoredPixels,
    maskedPixels,
    width,
    height,
    diffImage: PNG.sync.write(diff),
    ...(sized
      ? { sizeMismatch: { ref: `${rawRef.width}x${rawRef.height}`, app: `${rawApp.width}x${rawApp.height}`, comparedRegion: `${width}x${height}` } }
      : {}),
  };
}
