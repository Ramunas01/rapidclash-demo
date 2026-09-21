import { describe, beforeEach, afterEach, it, expect } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import type { FastifyInstance } from 'fastify';
import { createServices, buildApp, type AppServices } from './server.js';

// Ticket 2026-09-21#11 (active-incident follow-up to D36): with no cache headers, every static
// file — including assets/'s content-hashed, permanently-immutable build output — required
// revalidation on every single request, multiplying load on the one concurrency-capped Cloud Run
// instance every time a visitor reloaded. Proves the fix is scoped EXACTLY as narrowly as intended:
// only /assets/* gets the long-lived immutable cache; index.html/sw.js/manifest — which must always
// revalidate so a deploy's new references actually reach visitors, and to avoid a stuck service
// worker — are completely untouched.

describe('static asset caching (ticket 2026-09-21#11)', () => {
  let app: FastifyInstance;
  let services: AppServices;
  let distDir: string;
  let savedWebDist: string | undefined;

  beforeEach(async () => {
    distDir = mkdtempSync(join(tmpdir(), 'rc-static-cache-'));
    mkdirSync(join(distDir, 'assets'));
    writeFileSync(join(distDir, 'assets', 'keno-B2ChlCB2.webp'), 'fake-image-bytes');
    writeFileSync(join(distDir, 'index.html'), '<!doctype html><html></html>');
    writeFileSync(join(distDir, 'sw.js'), '// service worker');
    writeFileSync(join(distDir, 'manifest.webmanifest'), '{}');

    savedWebDist = process.env.WEB_DIST;
    process.env.WEB_DIST = distDir;

    const db = new Database(':memory:');
    services = createServices(db, []);
    app = buildApp(services, [], { seedAdmin: false, serveStatic: true });
  });

  afterEach(async () => {
    await app.close();
    rmSync(distDir, { recursive: true, force: true });
    if (savedWebDist === undefined) delete process.env.WEB_DIST;
    else process.env.WEB_DIST = savedWebDist;
  });

  it('/assets/* gets a long-lived, immutable Cache-Control header', async () => {
    const res = await app.inject({ method: 'GET', url: '/assets/keno-B2ChlCB2.webp' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['cache-control']).toBe('public, max-age=31536000, immutable');
  });

  it('index.html (the SPA entry point) keeps NO long-lived cache — must always revalidate so a deploy reaches visitors', async () => {
    const res = await app.inject({ method: 'GET', url: '/index.html' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['cache-control']).not.toBe('public, max-age=31536000, immutable');
  });

  it('sw.js (the service worker) keeps NO long-lived cache — a stale SW stuck controlling the page is a real PWA footgun', async () => {
    const res = await app.inject({ method: 'GET', url: '/sw.js' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['cache-control']).not.toBe('public, max-age=31536000, immutable');
  });

  it('manifest.webmanifest keeps NO long-lived cache either', async () => {
    const res = await app.inject({ method: 'GET', url: '/manifest.webmanifest' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['cache-control']).not.toBe('public, max-age=31536000, immutable');
  });

  it('the SPA fallback (an unknown client route) is served via index.html and also gets no long-lived cache', async () => {
    const res = await app.inject({ method: 'GET', url: '/some/client/route' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/html');
    expect(res.headers['cache-control']).not.toBe('public, max-age=31536000, immutable');
  });
});
