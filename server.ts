import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApiApp } from './server/apiApp.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT) || 3000;
const isProd = process.env.NODE_ENV === 'production';

async function createServer() {
  const app = createApiApp();

  // Health check — Render và người dùng dùng endpoint này để kiểm tra API
  app.get('/api/health', (_req, res) => {
    res.json({
      ok: true,
      service: 'MathDocx Studio API',
      hasGeminiKey: Boolean(process.env.GEMINI_API_KEY),
      nodeEnv: process.env.NODE_ENV || 'undefined',
      time: new Date().toISOString(),
    });
  });

  // Mọi /api/* không khớp route → JSON 404, tuyệt đối không trả HTML SPA
  app.use('/api', (req, res, next) => {
    if (!res.headersSent) {
      res.status(404).json({
        error: `API không tồn tại: ${req.method} ${req.originalUrl}`,
      });
      return;
    }
    next();
  });

  if (isProd) {
    const distDir = path.join(__dirname, 'dist');
    if (!fs.existsSync(path.join(distDir, 'index.html'))) {
      console.error(
        '[FATAL] Không tìm thấy dist/index.html. Trên Render hãy để Build Command: npm install && npm run build'
      );
      process.exit(1);
    }
    app.use(express.static(distDir));
    app.get('*', (req, res, next) => {
      if (req.path.startsWith('/api')) {
        res.status(404).json({ error: `API không tồn tại: ${req.path}` });
        return;
      }
      res.sendFile(path.join(distDir, 'index.html'), (err) => {
        if (err) next(err);
      });
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
    console.log(`MathDocx Studio listening on 0.0.0.0:${PORT} (${isProd ? 'production' : 'dev'})`);
    if (!process.env.GEMINI_API_KEY) {
      console.warn('[WARN] GEMINI_API_KEY chưa được set — OCR sẽ lỗi.');
    }
  });
}

createServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
