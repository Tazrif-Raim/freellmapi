import crypto from 'crypto';

const GATEWAY_KEY_PREFIX = 'freellmapi-';

export function generateGatewayApiKey(): string {
  return `${GATEWAY_KEY_PREFIX}${crypto.randomBytes(24).toString('hex')}`;
}

export function hashGatewayApiKey(rawKey: string): string {
  return crypto.createHash('sha256').update(rawKey).digest('hex');
}

export function getGatewayKeyPreview(rawKey: string): string {
  if (rawKey.length <= 18) {
    return `${rawKey.slice(0, 8)}...${rawKey.slice(-4)}`;
  }

  return `${rawKey.slice(0, 15)}...${rawKey.slice(-4)}`;
}
