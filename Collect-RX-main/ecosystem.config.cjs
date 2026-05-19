/**
 * PM2 — run CollectRx in the background on your Mac (survives terminal close).
 *
 *   npm run pm2:start    # start API (+ worker if REDIS_URL in .env)
 *   npm run pm2:status
 *   npm run pm2:logs
 *   npm run pm2:stop
 *
 * Requires: npm install -g pm2   (or: npx pm2 …)
 */
const path = require('path');

const appDir = __dirname;
require('dotenv').config({ path: path.join(appDir, '.env') });

const hasRedis = Boolean(process.env.REDIS_URL);

const apps = [
  {
    name: 'collectrx-api',
    cwd: appDir,
    script: 'npm',
    args: 'run start',
    interpreter: 'none',
    env: {
      NODE_ENV: process.env.NODE_ENV || 'development',
    },
    max_restarts: 10,
    autorestart: true,
  },
];

if (hasRedis) {
  apps.push({
    name: 'collectrx-worker',
    cwd: appDir,
    script: 'npm',
    args: 'run worker',
    interpreter: 'none',
    env: {
      NODE_ENV: process.env.NODE_ENV || 'development',
    },
    max_restarts: 10,
    autorestart: true,
  });
}

module.exports = { apps };
