import pixelmatch from 'pixelmatch';
import { PNG } from 'pngjs';

export interface DiffResult {
  /** Fidelity as a percentage: 100 = pixel-identical, lower = more drift. */
  fidelity: number;
  diffPixels: number;
  totalPixels: number;
  width: number;
  height: number;
  /** PNG buffer highlighting the differing pixels, or null if the sizes did not match. */
  diffImage: Buffer | null;
  sizeMismatch?: { a: string; b: string };
}

/**
 * Compare two PNG buffers. `threshold` is pixelmatch's per-pixel colour-distance tolerance
 * (0–1); 0.1 is its default and forgiving enough for antialiasing without hiding real drift.
 */
export function diffPng(a: Buffer, b: Buffer, threshold = 0.1): DiffResult {
  const imgA = PNG.sync.read(a);
  const imgB = PNG.sync.read(b);

  if (imgA.width !== imgB.width || imgA.height !== imgB.height) {
    return {
      fidelity: 0,
      diffPixels: imgA.width * imgA.height,
      totalPixels: imgA.width * imgA.height,
      width: imgA.width,
      height: imgA.height,
      diffImage: null,
      sizeMismatch: { a: `${imgA.width}x${imgA.height}`, b: `${imgB.width}x${imgB.height}` },
    };
  }

  const { width, height } = imgA;
  const diff = new PNG({ width, height });
  const diffPixels = pixelmatch(imgA.data, imgB.data, diff.data, width, height, {
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
  };
}
