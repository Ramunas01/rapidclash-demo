/**
 * A minimal hand-rolled stand-in for `three`, used by `vi.mock('three', ...)` in coin-related tests.
 *
 * jsdom has no real WebGL context (`canvas.getContext('webgl')` returns `null`), so the real
 * `THREE.WebGLRenderer` throws when constructed in a unit test — mirrors why `canvas-confetti` is
 * mocked elsewhere in this suite (Result.test.tsx, HiloHub.test.tsx, …). This stub implements just
 * enough of the API surface `Coin.tsx` calls (Scene/PerspectiveCamera/WebGLRenderer/CylinderGeometry/
 * MeshBasicMaterial/CanvasTexture/Mesh/AmbientLight/DirectionalLight) to run the component's real
 * logic — the flip math, rotation, disposal calls — without ever touching a real GPU/canvas context.
 * `Coin.test.tsx` also imports the exported recorders below to assert on constructor args and
 * dispose() calls; `CoinflipHub.test.tsx` only needs it to avoid the WebGL crash.
 *
 * `AmbientLight`/`DirectionalLight` are kept implemented here even though the flat/unlit fix
 * (ADVISOR_TO_PM.md 2026-07-11#3) means `Coin.tsx` no longer constructs either — `sceneAdded` below
 * lets `Coin.test.tsx` assert the scene ends up with none of them, which only works if the stub still
 * knows how to recognize them.
 */

class FakeVector3 {
  x = 0;
  y = 0;
  z = 0;
  set(x: number, y: number, z: number) {
    this.x = x;
    this.y = y;
    this.z = z;
    return this;
  }
}

export const capturedMaterials: MeshBasicMaterial[] = [];
export const capturedGeometryArgs: Array<{
  top: number;
  bottom: number;
  height: number;
  radialSegments: number;
}> = [];
export const geometryRotateXCalls: number[] = [];
export const rendererRenderCalls = { count: 0 };
export const rendererDisposed = { value: false };
export const geometryDisposed = { value: false };
/** Everything ever passed to any `Scene#add` call, across every `Scene` instance — lets tests assert
 *  on what got added to the scene (e.g. "no lights") without needing a handle on the Scene itself. */
export const sceneAdded: unknown[] = [];

/** Matches three's real string constant (`three.core.js`: `const SRGBColorSpace = 'srgb';`). */
export const SRGBColorSpace = 'srgb';

/** Reset all recorders — call in `beforeEach` so assertions don't bleed across tests. */
export function resetThreeStub() {
  capturedMaterials.length = 0;
  capturedGeometryArgs.length = 0;
  geometryRotateXCalls.length = 0;
  rendererRenderCalls.count = 0;
  rendererDisposed.value = false;
  geometryDisposed.value = false;
  sceneAdded.length = 0;
}

export class Scene {
  children: unknown[] = [];
  add(obj: unknown) {
    this.children.push(obj);
    sceneAdded.push(obj);
  }
}

export class PerspectiveCamera {
  position = new FakeVector3();
  aspect: number;
  constructor(
    public fov: number,
    aspect: number,
    public near: number,
    public far: number
  ) {
    this.aspect = aspect;
  }
  lookAt() {}
  updateProjectionMatrix() {}
}

export class WebGLRenderer {
  domElement: HTMLCanvasElement;
  lastSetSize: [number, number, boolean] | undefined;
  constructor(opts: { canvas: HTMLCanvasElement }) {
    this.domElement = opts.canvas;
  }
  setClearColor() {}
  setPixelRatio() {}
  setSize(w: number, h: number, updateStyle = true) {
    this.lastSetSize = [w, h, updateStyle];
  }
  render() {
    rendererRenderCalls.count += 1;
  }
  dispose() {
    rendererDisposed.value = true;
  }
}

export class CylinderGeometry {
  constructor(top: number, bottom: number, height: number, radialSegments: number) {
    capturedGeometryArgs.push({ top, bottom, height, radialSegments });
  }
  rotateX(angle: number) {
    geometryRotateXCalls.push(angle);
  }
  dispose() {
    geometryDisposed.value = true;
  }
}

export class CanvasTexture {
  disposed = false;
  needsUpdate = false;
  name = '';
  colorSpace = 'no-colorspace'; // three's real NoColorSpace default, until Coin.tsx sets it explicitly
  constructor(public canvas: HTMLCanvasElement) {}
  dispose() {
    this.disposed = true;
  }
}

// Real `MeshBasicMaterial` has no `metalness`/`roughness` (those are `MeshStandardMaterial`-only) —
// the stub's constructor type intentionally omits them so a stray `metalness`/`roughness` prop at a
// Coin.tsx call site would be a type error, not a silently-ignored option.
export class MeshBasicMaterial {
  color?: string;
  map?: CanvasTexture;
  disposed = false;
  constructor(opts: { color?: string; map?: CanvasTexture }) {
    Object.assign(this, opts);
    capturedMaterials.push(this);
  }
  dispose() {
    this.disposed = true;
  }
}

export class Mesh {
  rotation = new FakeVector3();
  constructor(
    public geometry: unknown,
    public material: unknown[]
  ) {}
}

export class AmbientLight {
  constructor(
    public color: unknown,
    public intensity: number
  ) {}
}

export class DirectionalLight {
  position = new FakeVector3();
  constructor(
    public color: unknown,
    public intensity: number
  ) {}
}
