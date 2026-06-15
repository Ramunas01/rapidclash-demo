import { describe, beforeAll, afterAll, it, expect } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import type { FastifyInstance } from 'fastify';
import { createServices, buildApp } from './server.js';
import { rpsModule } from '@rapidclash/game-rps';
import { coinflipModule } from '@rapidclash/game-coinflip';

// Production single-origin serving (ADR-009): the one container serves the built PWA AND
// the API/WS. We point WEB_DIST at a throwaway dist so the routing rules are testable
// without a real `vite build`.

const INDEX_HTML = '<!doctype html><title>RapidClash</title><div id="root"></div>';
const APP_JS = 'console.log("app bundle");';

describe('static PWA serving + SPA fallback (single origin)', () => {
  let app: FastifyInstance;
  let dist: string;

  beforeAll(async () => {
    dist = mkdtempSync(join(tmpdir(), 'rc-dist-'));
    writeFileSync(join(dist, 'index.html'), INDEX_HTML);
    mkdirSync(join(dist, 'assets'));
    writeFileSync(join(dist, 'assets', 'app.js'), APP_JS);
    writeFileSync(join(dist, 'sw.js'), '/* service worker */');
    writeFileSync(join(dist, 'manifest.webmanifest'), '{"name":"RapidClash"}');
    process.env.WEB_DIST = dist;

    const db = new Database(':memory:');
    const services = createServices(db, [rpsModule, coinflipModule]);
    app = buildApp(services, [rpsModule, coinflipModule], { seedAdmin: false, serveStatic: true });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    delete process.env.WEB_DIST;
    rmSync(dist, { recursive: true, force: true });
  });

  it('serves index.html at the bare origin', async () => {
    const res = await app.inject({ method: 'GET', url: '/' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/html');
    expect(res.body).toContain('<div id="root">');
  });

  it('serves real static assets by path with the right content type', async () => {
    const res = await app.inject({ method: 'GET', url: '/assets/app.js' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('javascript');
    expect(res.body).toContain('app bundle');
  });

  it('serves the service worker and manifest (PWA install)', async () => {
    const sw = await app.inject({ method: 'GET', url: '/sw.js' });
    expect(sw.statusCode).toBe(200);
    expect(sw.headers['content-type']).toContain('javascript');

    const manifest = await app.inject({ method: 'GET', url: '/manifest.webmanifest' });
    expect(manifest.statusCode).toBe(200);
    expect(manifest.headers['content-type']).toContain('manifest');
  });

  it('falls back to index.html for an unknown client route (SPA)', async () => {
    const res = await app.inject({ method: 'GET', url: '/lobby' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/html');
    expect(res.body).toContain('<div id="root">');
  });

  it('does NOT shadow the API — GET /games still returns the game list', async () => {
    const res = await app.inject({ method: 'GET', url: '/games' });
    expect(res.statusCode).toBe(200);
    const ids = res.json<Array<{ id: string }>>().map((g) => g.id);
    expect(ids).toContain('rps');
    expect(ids).toContain('coinflip');
  });

  it('an unknown API path 404s as JSON, never the SPA shell', async () => {
    const res = await app.inject({ method: 'GET', url: '/games/does-not-exist' });
    expect(res.statusCode).toBe(404);
    expect(res.headers['content-type']).toContain('application/json');
    expect(res.body).not.toContain('<div id="root">');
  });

  it('a non-GET to an unknown path 404s as JSON (no HTML fallback)', async () => {
    const res = await app.inject({ method: 'POST', url: '/totally-unknown' });
    expect(res.statusCode).toBe(404);
    expect(res.headers['content-type']).toContain('application/json');
  });
});

describe('static serving is OFF by default when no dist exists (dev/test)', () => {
  it('buildApp without a dist serves no SPA — unknown GET is a plain 404', async () => {
    const prev = process.env.WEB_DIST;
    process.env.WEB_DIST = join(tmpdir(), 'rc-nonexistent-dist-xyz');
    const db = new Database(':memory:');
    const services = createServices(db, [rpsModule]);
    const app = buildApp(services, [rpsModule], { seedAdmin: false }); // serveStatic auto → off
    await app.ready();
    const res = await app.inject({ method: 'GET', url: '/some-client-route' });
    expect(res.statusCode).toBe(404);
    expect(res.body).not.toContain('root');
    await app.close();
    if (prev === undefined) delete process.env.WEB_DIST;
    else process.env.WEB_DIST = prev;
  });
});
