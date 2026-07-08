import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import type { DesktopConnectorAgent } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';

const TOKEN_BYTES = 32;

export function generateConnectorToken(): string {
  return crypto.randomBytes(TOKEN_BYTES).toString('base64url');
}

export async function hashConnectorToken(token: string): Promise<string> {
  return bcrypt.hash(token, 12);
}

export async function verifyConnectorToken(
  token: string,
  tokenHash: string,
): Promise<boolean> {
  return bcrypt.compare(token, tokenHash);
}

export async function findActiveAgentByToken(
  token: string,
): Promise<DesktopConnectorAgent | null> {
  const agents = await prisma.desktopConnectorAgent.findMany({
    where: { revokedAt: null },
    orderBy: { createdAt: 'desc' },
    take: 200,
  });
  for (const agent of agents) {
    if (await verifyConnectorToken(token, agent.tokenHash)) return agent;
  }
  return null;
}

export async function mintConnectorAgent(
  practiceId: string,
  label = 'Practice PC',
): Promise<{ agent: DesktopConnectorAgent; token: string }> {
  const token = generateConnectorToken();
  const tokenHash = await hashConnectorToken(token);
  const agent = await prisma.desktopConnectorAgent.create({
    data: { practiceId, label, tokenHash },
  });
  return { agent, token };
}

export async function revokeConnectorAgent(agentId: string, practiceId: string): Promise<boolean> {
  const updated = await prisma.desktopConnectorAgent.updateMany({
    where: { id: agentId, practiceId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  return updated.count > 0;
}

export async function recordConnectorHeartbeat(
  agentId: string,
  practiceId: string,
  payload: {
    hostname?: string;
    agentVersion?: string;
    platform?: string;
    status?: string;
    message?: string;
    imported?: number;
  },
): Promise<void> {
  const now = new Date();
  const isSync = payload.status === 'ok' || payload.status === 'error' || payload.imported != null;
  await prisma.desktopConnectorAgent.updateMany({
    where: { id: agentId, practiceId, revokedAt: null },
    data: {
      hostname: payload.hostname ?? undefined,
      agentVersion: payload.agentVersion ?? undefined,
      platform: payload.platform ?? undefined,
      lastHeartbeatAt: now,
      ...(isSync
        ? {
            lastSyncAt: now,
            lastSyncStatus: payload.status ?? 'ok',
            lastSyncMessage: payload.message ?? null,
            lastImported: payload.imported ?? null,
          }
        : {}),
    },
  });
}

export function connectorHealth(agent: {
  revokedAt?: Date | null;
  lastHeartbeatAt?: Date | null;
  lastSyncStatus?: string | null;
}): 'healthy' | 'stale' | 'error' | 'revoked' | 'never' {
  if (agent.revokedAt) return 'revoked';
  if (!agent.lastHeartbeatAt) return 'never';
  const ageMs = Date.now() - agent.lastHeartbeatAt.getTime();
  if (agent.lastSyncStatus === 'error') return 'error';
  if (ageMs > 30 * 60 * 1000) return 'stale';
  return 'healthy';
}
