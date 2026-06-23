import fs from 'node:fs';
import path from 'node:path';
import type { Request, Response, NextFunction, RequestHandler } from 'express';

/** Slug under /resources/ → file under dist/resources/ */
const RESOURCE_PAGES: Record<string, string> = {
  '': 'index.html',
  'dental-insurance-follow-up-canada': 'dental-insurance-follow-up-canada/index.html',
  'canadian-dental-carriers-follow-up': 'canadian-dental-carriers-follow-up/index.html',
  'cdcp-claims-canada': 'cdcp-claims-canada/index.html',
};

/**
 * Serve pre-built SEO resource HTML before the SPA catch-all.
 * Vite copies public/resources/** into dist/resources/** at build time.
 */
export function createResourceStaticMiddleware(distPath: string): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') return next();

    if (req.path === '/resources') {
      res.redirect(301, '/resources/');
      return;
    }

    const match = req.path.match(/^\/resources\/?([^/]*)\/?$/);
    if (!match) return next();

    const rel = RESOURCE_PAGES[match[1] ?? ''];
    if (!rel) return next();

    const filePath = path.join(distPath, 'resources', rel);
    if (!fs.existsSync(filePath)) {
      if (process.env.NODE_ENV === 'production') {
        console.warn(`[resources] missing static file for ${req.path}: ${filePath}`);
      }
      return next();
    }

    res.type('html');
    if (req.method === 'HEAD') {
      res.end();
      return;
    }
    res.sendFile(filePath, (err) => {
      if (err) next(err);
    });
  };
}

/** Fail fast at boot when marketing pages were not copied into dist. */
export function assertResourcePagesBuilt(distPath: string): void {
  const missing: string[] = [];
  for (const rel of Object.values(RESOURCE_PAGES)) {
    const p = path.join(distPath, 'resources', rel);
    if (!fs.existsSync(p)) missing.push(p);
  }
  if (missing.length > 0) {
    throw new Error(
      `Missing marketing resource pages in dist (run vite build):\n${missing.join('\n')}`,
    );
  }
}
