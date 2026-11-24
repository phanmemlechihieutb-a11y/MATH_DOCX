import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApiApp } from './server/apiApp.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT) || 3000;

async function createServer() {
  const app = createApiApp();

  app.get('/api/health', (_req, res) => {
    res.json({
      ok: true,
      service: 'MathDocx Studio API',
      hasGeminiKey: Boolean(process.env.GEMINI_API_KEY),
      nodeEnv: process.env.NODE_ENV || 'undefined',
      time: new Date().toISOString(),
    });
  });

  // Mọi /api/* không khớp route → JSON 404 (không trả HTML SPA)
  app.use('/api', (req, res, next) => {
    if (!res.headersSent) {
      res.status(404).json({
        error: `API không tồn tại: ${req.method} ${req.originalUrl}`,
      });
      return;
    }
    next();
  });

  if (process.env.NODE_ENV === 'production') {
    const distDir = path.join(__dirname, 'dist');
    app.use(express.static(distDir));
    app.get('*', (req, res) => {
      if (req.path.startsWith('/api')) {
        res.status(404).json({ error: `API không tồn tại: ${req.path}` });
        return;
      }
      res.sendFile(path.join(distDir, 'index.html'));
    });
  } else {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`MathDocx Studio server listening on http://localhost:${PORT}`);
  });
}

createServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
