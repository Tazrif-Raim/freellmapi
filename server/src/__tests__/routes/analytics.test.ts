import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Express } from 'express';
import { createApp } from '../../app.js';
import { getDb, initDb } from '../../db/index.js';
import { mintDashboardToken, isGatedApiPath } from '../helpers/auth.js';

let dashToken = '';

async function request(app: Express, path: string) {
  const server = app.listen(0);
  const addr = server.address() as any;
  const url = `http://127.0.0.1:${addr.port}${path}`;

  const res = await fetch(url, {
    headers: isGatedApiPath(path) ? { Authorization: `Bearer ${dashToken}` } : {},
  });
  const data = await res.json().catch(() => null);
  server.close();

  return { status: res.status, body: data };
}

function insertRequest(createdAt: string, gatewayApiKeyId: number | null = null, status = 'success') {
  const db = getDb();
  db.prepare(`
    INSERT INTO requests (platform, model_id, gateway_api_key_id, status, input_tokens, output_tokens, latency_ms, error, created_at)
    VALUES ('test', 'test-model', ?, ?, 1, 2, 3, ?, ?)
  `).run(gatewayApiKeyId, status, status === 'error' ? 'boom' : null, createdAt);
}

describe('Analytics API', () => {
  let app: Express;

  beforeAll(() => {
    process.env.ENCRYPTION_KEY = '0'.repeat(64);
    initDb(':memory:');
    app = createApp();
    dashToken = mintDashboardToken();
  });

  beforeEach(() => {
    getDb().prepare('DELETE FROM requests').run();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-29T12:00:00.000Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('uses a rolling 24-hour window for summary analytics', async () => {
    insertRequest('2026-05-28 11:59:59');
    insertRequest('2026-05-28 12:00:00');
    insertRequest('2026-05-29 11:59:59');

    const { status, body } = await request(app, '/api/analytics/summary?range=24h');

    expect(status).toBe(200);
    expect(body.totalRequests).toBe(2);
    expect(body.totalInputTokens).toBe(2);
    expect(body.totalOutputTokens).toBe(4);
  });

  it.each([
    ['7d', '2026-05-22 11:59:59', '2026-05-22 12:00:00'],
    ['30d', '2026-04-29 11:59:59', '2026-04-29 12:00:00'],
  ])('uses a rolling %s window for summary analytics', async (range, outside, boundary) => {
    insertRequest(outside);
    insertRequest(boundary);
    insertRequest('2026-05-29 11:59:59');

    const { status, body } = await request(app, `/api/analytics/summary?range=${range}`);

    expect(status).toBe(200);
    expect(body.totalRequests).toBe(2);
  });

  it('filters summary analytics by gateway API key', async () => {
    insertRequest('2026-05-29 10:00:00', 1);
    insertRequest('2026-05-29 10:01:00', 2);
    insertRequest('2026-05-29 10:02:00', 2);

    const all = await request(app, '/api/analytics/summary?range=24h');
    const filtered = await request(app, '/api/analytics/summary?range=24h&gatewayApiKeyId=2');

    expect(all.body.totalRequests).toBe(3);
    expect(filtered.status).toBe(200);
    expect(filtered.body.totalRequests).toBe(2);
    expect(filtered.body.totalInputTokens).toBe(2);
  });

  it('treats legacy NULL gateway attribution as gateway key id 1', async () => {
    insertRequest('2026-05-29 10:00:00', null);
    insertRequest('2026-05-29 10:01:00', 1);
    insertRequest('2026-05-29 10:02:00', 2);

    const filtered = await request(app, '/api/analytics/summary?range=24h&gatewayApiKeyId=1');

    expect(filtered.status).toBe(200);
    expect(filtered.body.totalRequests).toBe(2);
  });

  it.each([
    ['by-platform', '/api/analytics/by-platform?range=24h&gatewayApiKeyId=2'],
    ['timeline', '/api/analytics/timeline?range=24h&gatewayApiKeyId=2'],
    ['by-model', '/api/analytics/by-model?range=24h&gatewayApiKeyId=2'],
    ['errors', '/api/analytics/errors?range=24h&gatewayApiKeyId=2'],
    ['error-distribution', '/api/analytics/error-distribution?range=24h&gatewayApiKeyId=2'],
  ])('applies gateway filtering to %s', async (endpoint, path) => {
    insertRequest('2026-05-29 10:00:00', 1, 'error');
    insertRequest('2026-05-29 10:01:00', 2, 'error');

    const { status, body } = await request(app, path);

    expect(status).toBe(200);
    if (endpoint === 'error-distribution') {
      expect(body.byCategory[0].count).toBe(1);
      expect(body.byPlatform[0].count).toBe(1);
      expect(body.detailed[0].count).toBe(1);
    } else if (endpoint === 'errors') {
      expect(body).toHaveLength(1);
    } else {
      expect(body).toHaveLength(1);
      expect(body[0].requests).toBe(1);
    }
  });

  it('rejects invalid gatewayApiKeyId values', async () => {
    const { status, body } = await request(app, '/api/analytics/summary?range=24h&gatewayApiKeyId=abc');

    expect(status).toBe(400);
    expect(body.error.message).toContain('gatewayApiKeyId');
  });
});
