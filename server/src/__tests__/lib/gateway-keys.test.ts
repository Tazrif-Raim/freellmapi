import { describe, expect, it } from 'vitest';
import {
  generateGatewayApiKey,
  getGatewayKeyPreview,
  hashGatewayApiKey,
} from '../../lib/gateway-keys.js';

describe('gateway key helpers', () => {
  it('generates unique recognisable keys', () => {
    const a = generateGatewayApiKey();
    const b = generateGatewayApiKey();

    expect(a).toMatch(/^freellmapi-[a-f0-9]{48}$/);
    expect(b).toMatch(/^freellmapi-[a-f0-9]{48}$/);
    expect(a).not.toBe(b);
  });

  it('hashes deterministically without preserving the raw key', () => {
    const key = 'freellmapi-test-key';

    expect(hashGatewayApiKey(key)).toBe(hashGatewayApiKey(key));
    expect(hashGatewayApiKey(key)).not.toContain(key);
  });

  it('previews keys without storing the full raw key', () => {
    const key = 'freellmapi-abcdefghijklmnopqrstuvwxyz1234567890';
    const preview = getGatewayKeyPreview(key);

    expect(preview).toBe('freellmapi-abcd...7890');
    expect(preview).not.toBe(key);
  });
});
