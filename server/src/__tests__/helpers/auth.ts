import { createUser, createSession } from '../../services/auth.js';
import { getDb } from '../../db/index.js';
import {
  generateGatewayApiKey,
  getGatewayKeyPreview,
  hashGatewayApiKey,
} from '../../lib/gateway-keys.js';

// Dashboard /api/* routes are gated by requireAuth (#35). Tests mint a session
// token once (after initDb) and attach it to gated requests.

export function mintDashboardToken(email = 'test@example.com'): string {
  const user = createUser(email, 'password123');
  return createSession(user.userId);
}

// Gated = under /api/ but not the public bootstrap routes (/api/auth/*, /api/ping).
export function isGatedApiPath(path: string): boolean {
  return path.startsWith('/api/') && !path.startsWith('/api/auth') && path !== '/api/ping';
}

export function createTestGatewayApiKey(label = 'Test gateway'): string {
  const key = generateGatewayApiKey();
  getDb().prepare(`
    INSERT INTO gateway_api_keys (label, key_hash, key_preview, enabled)
    VALUES (?, ?, ?, 1)
  `).run(label, hashGatewayApiKey(key), getGatewayKeyPreview(key));
  return key;
}
