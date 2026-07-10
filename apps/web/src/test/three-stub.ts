/**
 * A minimal hand-rolled stand-in for `three`, used by `vi.mock('three', ...)` in coin-related tests.
 *
 * jsdom has no real WebGL context (`canvas.getContext('webgl')` returns `null`), so the real
 * `THREE.WebGLRenderer` throws when constructed in a unit test — mirrors why `canvas-confetti` is
 * mocked elsewhere in this suite (Result.test.tsx, HiloHub.test.tsx, …). This stub implements just
 * enough of the API surface `Coin.tsx` calls (Scene/PerspectiveCamera/WebGLRenderer/CylinderGeometry/
 * MeshStandardMaterial/CanvasTexture/Mesh/AmbientLight/DirectionalLight) to run the component's real
 * logic — the flip math, rotation, disposal calls — without ever touching a real GPU/canvas context.
 * `Coin.test.tsx` also imports the exported recorders below to assert on constructor args and
 * dispose() calls; `CoinflipHub.test.tsx` only needs it to avoid the WebGL crash.
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

export const capturedMaterials: MeshStandardMaterial[] = [];
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

/** Reset all recorders — call in `beforeEach` so assertions don't bleed across tests. */
export function resetThreeStub() {
  capturedMaterials.length = 0;
  capturedGeometryArgs.length = 0;
  geometryRotateXCalls.length = 0;
  rendererRenderCalls.count = 0;
  rendererDisposed.value = false;
  geometryDisposed.value = false;
}

export class Scene {
  children: unknown[] = [];
  add(obj: unknown) {
    this.children.push(obj);
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
  constructor(public canvas: HTMLCanvasElement) {}
  dispose() {
    this.disposed = true;
  }
}

export class MeshStandardMaterial {
  color?: string;
  map?: CanvasTexture;
  metalness?: number;
  roughness?: number;
  disposed = false;
  constructor(opts: {
    color?: string;
    map?: CanvasTexture;
    metalness?: number;
    roughness?: number;
  }) {
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
