/**
 * Guards the /api/group contract against the Group Dashboard.
 *
 * confirm-overage shipped with a tested service function, a wired-up button,
 * and no route in between — the service test passed while a paused DSO had no
 * way to resume calling. Service-level coverage cannot catch a missing route,
 * so this asserts registration for every endpoint the group UI calls.
 */
import { describe, expect, it } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import { createGroupAdminRouter } from '../src/server/routes/groupAdminRoutes.js';

/** Paths the Group Dashboard and Group PMS Import page fetch, relative to the /api/group mount. */
const CALLED_BY_GROUP_UI: ReadonlyArray<{ method: string; path: string }> = [
  { method: 'get', path: '/practices-summary' },
  { method: 'get', path: '/billing' },
  { method: 'post', path: '/billing/checkout' },
  { method: 'post', path: '/billing/portal' },
  { method: 'post', path: '/billing/confirm-overage' },
  { method: 'patch', path: '/billing/cogs-pooling' },
  { method: 'post', path: '/pms-import' },
  { method: 'post', path: '/practices' },
  { method: 'get', path: '/members' },
  { method: 'patch', path: '/members/:userId' },
  { method: 'delete', path: '/members/:userId' },
];

interface RouteLayer {
  route?: { path: string; methods: Record<string, boolean> };
}

function registeredRoutes(): Set<string> {
  // The factory only touches prisma inside handlers, so registration needs no client.
  const router = createGroupAdminRouter({} as PrismaClient);
  const layers = (router as unknown as { stack: RouteLayer[] }).stack;
  const routes = new Set<string>();
  for (const layer of layers) {
    if (!layer.route) continue;
    for (const method of Object.keys(layer.route.methods)) {
      routes.add(`${method.toLowerCase()} ${layer.route.path}`);
    }
  }
  return routes;
}

describe('/api/group route surface', () => {
  const routes = registeredRoutes();

  it.each(CALLED_BY_GROUP_UI)('registers $method $path', ({ method, path }) => {
    expect(routes).toContain(`${method} ${path}`);
  });
});
