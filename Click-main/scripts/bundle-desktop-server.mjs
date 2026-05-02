/**
 * Bundle Express API + static dist path for CollectRx desktop (Electron).
 * Prisma stays external — ship node_modules/@prisma/client + .prisma in the .app.
 */
import * as esbuild from 'esbuild';
import { mkdirSync } from 'node:fs';

mkdirSync('desktop-backend', { recursive: true });

await esbuild.build({
  entryPoints: ['src/server/index.ts'],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  outfile: 'desktop-backend/server.cjs',
  external: ['@prisma/client', 'prisma'],
  logLevel: 'info',
});
