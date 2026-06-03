import { Router } from 'express';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { getDb } from '../db/index.js';
import {
  generateGatewayApiKey,
  getGatewayKeyPreview,
  hashGatewayApiKey,
} from '../lib/gateway-keys.js';

export const gatewayKeysRouter = Router();

interface GatewayKeyRow {
  id: number;
  label: string;
  key_hash: string;
  key_preview: string;
  enabled: number;
  is_deleted: number;
  created_at: string;
  last_used_at: string | null;
}

const createGatewayKeySchema = z.object({
  label: z.string().max(120).optional(),
});

const updateGatewayKeySchema = z.object({
  label: z.string().max(120).optional(),
  enabled: z.boolean().optional(),
}).refine(data => data.label !== undefined || data.enabled !== undefined, {
  message: 'At least one of label or enabled must be provided',
});

function parseId(req: Request, res: Response): number | undefined {
  const id = Number.parseInt(req.params.id as string, 10);
  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ error: { message: 'Invalid gateway key ID' } });
    return undefined;
  }
  return id;
}

function toResponse(row: GatewayKeyRow) {
  return {
    id: row.id,
    label: row.label,
    keyPreview: row.key_preview,
    enabled: row.enabled === 1,
    isDeleted: row.is_deleted === 1,
    createdAt: row.created_at,
    lastUsedAt: row.last_used_at,
  };
}

function getGatewayKeyById(id: number): GatewayKeyRow | undefined {
  return getDb()
    .prepare('SELECT * FROM gateway_api_keys WHERE id = ?')
    .get(id) as GatewayKeyRow | undefined;
}

function activeKeyCountExcept(id: number): number {
  const row = getDb().prepare(`
    SELECT COUNT(*) AS cnt
    FROM gateway_api_keys
    WHERE enabled = 1 AND is_deleted = 0 AND id <> ?
  `).get(id) as { cnt: number };
  return row.cnt;
}

gatewayKeysRouter.get('/', (req: Request, res: Response) => {
  const includeDeleted = req.query.includeDeleted === 'true' || req.query.includeDeleted === '1';
  const db = getDb();
  const rows = db.prepare(`
    SELECT * FROM gateway_api_keys
    ${includeDeleted ? '' : 'WHERE is_deleted = 0'}
    ORDER BY created_at DESC, id DESC
  `).all() as GatewayKeyRow[];

  res.json(rows.map(toResponse));
});

gatewayKeysRouter.post('/', (req: Request, res: Response) => {
  const parsed = createGatewayKeySchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: { message: parsed.error.errors.map(e => e.message).join(', ') } });
    return;
  }

  const rawKey = generateGatewayApiKey();
  const label = parsed.data.label?.trim() ?? '';
  const keyHash = hashGatewayApiKey(rawKey);
  const keyPreview = getGatewayKeyPreview(rawKey);
  const db = getDb();

  const result = db.prepare(`
    INSERT INTO gateway_api_keys (label, key_hash, key_preview, enabled)
    VALUES (?, ?, ?, 1)
  `).run(label, keyHash, keyPreview);

  const row = getGatewayKeyById(Number(result.lastInsertRowid));
  if (!row) {
    res.status(500).json({ error: { message: 'Gateway key was created but could not be loaded' } });
    return;
  }

  res.status(201).json({ ...toResponse(row), key: rawKey });
});

gatewayKeysRouter.patch('/:id', (req: Request, res: Response) => {
  const id = parseId(req, res);
  if (id === undefined) return;

  const parsed = updateGatewayKeySchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: { message: parsed.error.errors.map(e => e.message).join(', ') } });
    return;
  }

  const existing = getGatewayKeyById(id);
  if (!existing || existing.is_deleted === 1) {
    res.status(404).json({ error: { message: 'Gateway key not found' } });
    return;
  }

  if (parsed.data.enabled === false && existing.enabled === 1 && activeKeyCountExcept(id) === 0) {
    res.status(400).json({ error: { message: 'Cannot disable the last active gateway key' } });
    return;
  }

  const updates: string[] = [];
  const values: Array<string | number> = [];
  if (parsed.data.label !== undefined) {
    updates.push('label = ?');
    values.push(parsed.data.label.trim());
  }
  if (parsed.data.enabled !== undefined) {
    updates.push('enabled = ?');
    values.push(parsed.data.enabled ? 1 : 0);
  }
  values.push(id);

  const db = getDb();
  db.prepare(`UPDATE gateway_api_keys SET ${updates.join(', ')} WHERE id = ?`).run(...values);
  const updated = getGatewayKeyById(id);
  res.json(toResponse(updated!));
});

gatewayKeysRouter.delete('/:id', (req: Request, res: Response) => {
  const id = parseId(req, res);
  if (id === undefined) return;

  const existing = getGatewayKeyById(id);
  if (!existing || existing.is_deleted === 1) {
    res.status(404).json({ error: { message: 'Gateway key not found' } });
    return;
  }

  if (existing.enabled === 1 && activeKeyCountExcept(id) === 0) {
    res.status(400).json({ error: { message: 'Cannot revoke the last active gateway key' } });
    return;
  }

  getDb().prepare('UPDATE gateway_api_keys SET enabled = 0, is_deleted = 1 WHERE id = ?').run(id);
  res.json({ success: true });
});

gatewayKeysRouter.post('/:id/regenerate', (req: Request, res: Response) => {
  const id = parseId(req, res);
  if (id === undefined) return;

  const existing = getGatewayKeyById(id);
  if (!existing || existing.is_deleted === 1) {
    res.status(404).json({ error: { message: 'Gateway key not found' } });
    return;
  }

  const rawKey = generateGatewayApiKey();
  getDb().prepare(`
    UPDATE gateway_api_keys
    SET key_hash = ?, key_preview = ?, enabled = 1
    WHERE id = ?
  `).run(hashGatewayApiKey(rawKey), getGatewayKeyPreview(rawKey), id);

  const updated = getGatewayKeyById(id);
  res.json({ ...toResponse(updated!), key: rawKey });
});
