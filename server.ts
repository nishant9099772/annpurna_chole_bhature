/**
 * Annpurna Chole Bhature - Local & Container Server Entrypoint
 * Mounts the pure production API routes from ./src/server/apiApp.ts
 * and attaches Vite dev middleware (in development) or static SPA serving (in standalone production).
 * Note: Netlify Serverless Functions import ./src/server/apiApp.ts directly so Vite is never bundled.
 */
import express, { Request, Response, NextFunction } from 'express';
import path from 'path';
import fs from 'fs';
import { app, PORT, ADMIN_USERNAME } from './src/server/apiApp';

const isProduction = process.env.NODE_ENV === 'production';

async function startServer() {
  if (!isProduction) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });

    // Guard: Any request starting with /api is strictly blocked from falling into vite HTML handler
    app.use((req: Request, res: Response, next: NextFunction) => {
      if (req.path.startsWith('/api') || req.url.startsWith('/api')) {
        return res.status(404).json({
          error: `API route not found: ${req.method} ${req.originalUrl}`,
        });
      }
      vite.middlewares(req, res, next);
    });
  } else {
    const distPath = path.resolve(process.cwd(), 'dist');

    app.use(express.static(distPath));
    app.get('*', (req: Request, res: Response) => {
      if (req.path.startsWith('/api')) {
        return res.status(404).json({ error: `API route not found: ${req.method} ${req.originalUrl}` });
      }
      const indexPath = path.resolve(distPath, 'index.html');
      if (fs.existsSync(indexPath)) {
        res.sendFile(indexPath);
      } else {
        res.status(404).send('Application build not found. Please run npm run build.');
      }
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`=================================================`);
    console.log(` Annpurna Chole Bhature Billing Server Running`);
    console.log(` Port: ${PORT} | Timezone: Asia/Kolkata`);
    console.log(` Admin User: ${ADMIN_USERNAME}`);
    console.log(`=================================================`);
  });
}

if (!process.env.NETLIFY && !process.env.AWS_LAMBDA_FUNCTION_NAME) {
  startServer();
}

export { app };
export default app;
