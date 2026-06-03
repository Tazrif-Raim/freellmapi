import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Express } from 'express';
import { createApp } from '../../app.js';
import { getDb, initDb } from '../../db/index.js';
import { isGatedApiPath, mintDashboardToken } from '../helpers/auth.js';

let dashToken = '';

async function request(app: Express, method: string, path: string, body?: any, headers: Record<string, string> = {}) {
  const server = app.listen(0);
  const addr = server.address() as any;
  const url = `http://127.0.0.1:${addr.port}${path}`;

  const res = await fetch(url, {
    method,
    headers: {
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(isGatedApiPath(path) && !('Authorization' in headers) ? { Authorization: `Bearer ${dashToken}` } : {}),
      ...headers,
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  const text = await res.text();
  server.close();

  let json: any = null;
  try { json = JSON.parse(text); } catch {}
  return { status: res.status, body: json, headers: res.headers };
}

async function createGatewayKey(app: Express, label = 'Test gateway') {
  const { status, body } = await request(app, 'POST', '/api/gateway-keys', { label });
  expect(status).toBe(201);
  return body as { id: number; key: string; keyPreview: string; label: string };
}

describe('Gateway API keys', () => {
  let app: Express;

  beforeAll(() => {
    process.env.ENCRYPTION_KEY = '0'.repeat(64);
    initDb(':memory:');
    app = createApp();
    dashToken = mintDashboardToken();
  });

  beforeEach(() => {
    getDb().exec('DELETE FROM requests; DELETE FROM api_keys; DELETE FROM gateway_api_keys;');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('creates the gateway table and request attribution column', () => {
    const gatewayColumns = getDb().prepare('PRAGMA table_info(gateway_api_keys)').all() as Array<{ name: string }>;
    const requestColumns = getDb().prepare('PRAGMA table_info(requests)').all() as Array<{ name: string }>;
    const requestIndexes = getDb().prepare('PRAGMA index_list(requests)').all() as Array<{ name: string }>;

    expect(gatewayColumns.map(col => col.name)).toContain('key_hash');
    expect(requestColumns.map(col => col.name)).toContain('gateway_api_key_id');
    expect(requestIndexes.map(idx => idx.name)).toContain('idx_requests_gateway_api_key_id');
  });

  it('returns raw keys only on create and stores only hash plus preview', async () => {
    const created = await createGatewayKey(app, 'Mobile app');
    expect(created.key).toMatch(/^freellmapi-/);
    expect(created.keyPreview).not.toBe(created.key);

    const row = getDb().prepare('SELECT key_hash, key_preview FROM gateway_api_keys WHERE id = ?').get(created.id) as { key_hash: string; key_preview: string };
    expect(row.key_hash).not.toBe(created.key);
    expect(row.key_hash).not.toContain(created.key);
    expect(row.key_preview).toBe(created.keyPreview);

    const list = await request(app, 'GET', '/api/gateway-keys');
    expect(list.status).toBe(200);
    expect(list.body[0]).not.toHaveProperty('key');
    expect(list.body[0]).toMatchObject({ id: created.id, label: 'Mobile app', keyPreview: created.keyPreview });
  });

  it('rejects disabled and deleted gateway keys at the proxy boundary', async () => {
    const disabled = await createGatewayKey(app, 'Disabled');
    const active = await createGatewayKey(app, 'Active');
    const deleted = await createGatewayKey(app, 'Deleted');

    expect((await request(app, 'PATCH', `/api/gateway-keys/${disabled.id}`, { enabled: false })).status).toBe(200);
    expect((await request(app, 'DELETE', `/api/gateway-keys/${deleted.id}`)).status).toBe(200);

    const valid = await request(app, 'POST', '/v1/chat/completions', {
      messages: [{ role: 'user', content: 'hello' }],
    }, { Authorization: `Bearer ${active.key}` });
    expect(valid.status).not.toBe(401);

    for (const key of [disabled.key, deleted.key, 'freellmapi-not-a-real-key']) {
      const res = await request(app, 'POST', '/v1/chat/completions', {
        messages: [{ role: 'user', content: 'hello' }],
      }, { Authorization: `Bearer ${key}` });
      expect(res.status).toBe(401);
      expect(res.body.error.type).toBe('authentication_error');
    }
  });

  it('updates last_used_at after successful gateway authentication', async () => {
    const key = await createGatewayKey(app);

    await request(app, 'POST', '/v1/chat/completions', {
      messages: [{ role: 'user', content: 'hello' }],
    }, { 'x-api-key': key.key });

    const row = getDb().prepare('SELECT last_used_at FROM gateway_api_keys WHERE id = ?').get(key.id) as { last_used_at: string | null };
    expect(row.last_used_at).toBeTruthy();
  });

  it('regenerates in-place and invalidates the old raw key', async () => {
    const key = await createGatewayKey(app);
    const regenerated = await request(app, 'POST', `/api/gateway-keys/${key.id}/regenerate`);

    expect(regenerated.status).toBe(200);
    expect(regenerated.body.id).toBe(key.id);
    expect(regenerated.body.key).not.toBe(key.key);

    const oldKeyResult = await request(app, 'POST', '/v1/chat/completions', {
      messages: [{ role: 'user', content: 'hello' }],
    }, { Authorization: `Bearer ${key.key}` });
    expect(oldKeyResult.status).toBe(401);

    const newKeyResult = await request(app, 'POST', '/v1/chat/completions', {
      messages: [{ role: 'user', content: 'hello' }],
    }, { Authorization: `Bearer ${regenerated.body.key}` });
    expect(newKeyResult.status).not.toBe(401);
  });

  it('logs gateway key attribution separately from provider key attribution', async () => {
    const gatewayKey = await createGatewayKey(app);
    const providerKey = await request(app, 'POST', '/api/keys', {
      platform: 'groq',
      key: 'gsk_gateway_attribution_test',
      label: 'provider',
    });
    expect(providerKey.status).toBe(201);

    const origFetch = global.fetch;
    vi.spyOn(global, 'fetch').mockImplementation(async (url, init) => {
      const urlStr = typeof url === 'string' ? url : url.toString();
      if (urlStr.includes('api.groq.com/openai/v1/chat/completions')) {
        return {
          ok: true,
          json: () => Promise.resolve({
            choices: [{ message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' }],
            usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
          }),
        } as any;
      }
      return origFetch(url, init);
    });

    const res = await request(app, 'POST', '/v1/chat/completions', {
      messages: [{ role: 'user', content: 'hello' }],
    }, { Authorization: `Bearer ${gatewayKey.key}` });
    expect(res.status).toBe(200);

    const row = getDb().prepare('SELECT key_id, gateway_api_key_id FROM requests ORDER BY id DESC LIMIT 1').get() as {
      key_id: number;
      gateway_api_key_id: number;
    };
    expect(row.key_id).toBe(providerKey.body.id);
    expect(row.gateway_api_key_id).toBe(gatewayKey.id);
  });
});
