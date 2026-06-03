import { Router } from 'express';
import type { Request, Response } from 'express';

export const settingsRouter = Router();

// Legacy endpoint kept only so older dashboard bundles receive a clear message.
// Gateway keys are now managed through /api/gateway-keys and raw keys are shown
// only immediately after create/regenerate.
settingsRouter.get('/api-key', (_req: Request, res: Response) => {
  res.status(410).json({
    error: {
      message: 'Unified API key settings were replaced by gateway API keys. Use /api/gateway-keys.',
      type: 'gone',
    },
  });
});

settingsRouter.post('/api-key/regenerate', (_req: Request, res: Response) => {
  res.status(410).json({
    error: {
      message: 'Unified API key regeneration was replaced by gateway API key regeneration. Use /api/gateway-keys/:id/regenerate.',
      type: 'gone',
    },
  });
});
