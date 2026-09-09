import pixelmatch from 'pixelmatch';
import { PNG } from 'pngjs';

export interface DiffResult {
  /** Fidelity as a percentage: 100 = pixel-identical, lower = more drift. */
  fidelity: number;
  diffPixels: number;
  totalPixels: number;
  width: number;
  height: number;
  /** PNG buffer highlighting the differing pixels. */
  diffImage: Buffer;
  /** Set when the two inputs weren't the same size — the diff then covers the shared top-left region. */
  sizeMismatch?: { ref: string; app: string; comparedRegion: string };
}

/** Crop a decoded PNG to a top-left w×h window. */
function crop(img: PNG, w: number, h: number): PNG {
  if (img.width === w && img.height === h) return img;
  const out = new PNG({ width: w, height: h });
  PNG.bitblt(img, out, 0, 0, w, h, 0, 0);
  return out;
}

/**
 * Compare two PNG buffers. `threshold` is pixelmatch's per-pixel colour-distance tolerance
 * (0–1); 0.1 is its default and forgiving enough for antialiasing without hiding real drift.
 *
 * When the images differ in size (the prototype reference is chrome-clipped, the app capture is
 * the full viewport — and until Designer Q2/Q3 land, "1:1" means the above-the-fold region), the
 * diff covers the shared top-left window and the result is flagged.
 */
export function diffPng(refPng: Buffer, appPng: Buffer, threshold = 0.1): DiffResult {
  const rawRef = PNG.sync.read(refPng);
  const rawApp = PNG.sync.read(appPng);

  const width = Math.min(rawRef.width, rawApp.width);
  const height = Math.min(rawRef.height, rawApp.height);
  const sized = rawRef.width !== rawApp.width || rawRef.height !== rawApp.height;

  const imgRef = crop(rawRef, width, height);
  const imgApp = crop(rawApp, width, height);

  const diff = new PNG({ width, height });
  const diffPixels = pixelmatch(imgRef.data, imgApp.data, diff.data, width, height, {
    threshold,
    includeAA: false,
  });
  const totalPixels = width * height;

  return {
    fidelity: Math.round((1 - diffPixels / totalPixels) * 10_000) / 100,
    diffPixels,
    totalPixels,
    width,
    height,
    diffImage: PNG.sync.write(diff),
    ...(sized
      ? {
          sizeMismatch: {
            ref: `${rawRef.width}x${rawRef.height}`,
            app: `${rawApp.width}x${rawApp.height}`,
            comparedRegion: `${width}x${height}`,
          },
        }
      : {}),
  };
}
