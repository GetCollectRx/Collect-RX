/**
 * P4-05 — Vapi server URL webhook: shared secret (X-Vapi-Secret or Bearer) + idempotent body hash.
 * @see https://docs.vapi.ai/server-url/server-authentication
 * @see https://docs.vapi.ai/server-url/events
 */

import { createHash } from 'crypto';
import type { PrismaClient } from '@prisma/client';
import type { Request, Response } from 'express';

function hashBody(buf: Buffer): string {
  return createHash('sha256').update(buf).digest('hex');
}

function verifyVapiAuth(req: Request): boolean {
  const secret = process.env.VAPI_WEBHOOK_SECRET;
  if (!secret) {
    return process.env.NODE_ENV !== 'production';
  }
  const x = req.get('x-vapi-secret') || req.get('X-Vapi-Secret');
  if (x && x === secret) {
    return true;
  }
  const auth = req.get('authorization') || '';
  const m = auth.match(/^Bearer\s+(.+)$/i);
  if (m?.[1] && m[1] === secret) {
    return true;
  }
  return false;
}

/**
 * Returns JSON body to send as the HTTP response (empty object for passive events).
 * assistant-request and tool-calls need structured responses when your assistant uses them.
 */
function responseForVapiMessage(body: unknown): Record<string, unknown> {
  const b = body as { message?: { type?: string; toolWithToolCallList?: Array<{ name: string; toolCall?: { id?: string } }> } };
  const type = b?.message?.type;
  if (type === 'assistant-request' && process.env.VAPI_DEFAULT_ASSISTANT_ID) {
    return { assistantId: process.env.VAPI_DEFAULT_ASSISTANT_ID };
  }
  if (type === 'tool-calls' && b.message?.toolWithToolCallList?.length) {
    return {
      results: b.message.toolWithToolCallList.map((t) => ({
        name: t.name,
        toolCallId: t.toolCall?.id,
        result: JSON.stringify({ ok: false, error: 'No tool handlers in CollectRx — configure tools in Vapi or implement here.' }),
      })),
    };
  }
  return {};
}

export async function handleVapiWebhook(
  req: Request & { vapiRawBody?: Buffer },
  res: Response,
  prisma: PrismaClient
): Promise<void> {
  if (!verifyVapiAuth(req)) {
    res.status(401).json({ error: 'Invalid or missing Vapi authentication' });
    return;
  }

  const buf = req.vapiRawBody;
  if (!buf || !Buffer.isBuffer(buf)) {
    res.status(400).json({ error: 'Missing raw body' });
    return;
  }

  const bodyHash = hashBody(buf);
  try {
    await prisma.processedVapiWebhook.create({ data: { bodyHash } });
  } catch (e: unknown) {
    const code = (e as { code?: string }).code;
    if (code === 'P2002') {
      res.status(200).json({ ok: true, duplicate: true });
      return;
    }
    throw e;
  }

  const payload = req.body;
  const out = responseForVapiMessage(payload);
  res.status(200).json(out);
}
