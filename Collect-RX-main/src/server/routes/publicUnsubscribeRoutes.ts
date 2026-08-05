/**
 * GET/POST /api/public/prospect-unsubscribe — the route the List-Unsubscribe
 * / List-Unsubscribe-Post headers on cold outreach email
 * (marketing/prospectEmail.ts) actually point at. It didn't exist until now:
 * the URL was built and embedded in every outreach email's headers, but
 * nothing in src/server ever handled it, so both the mail-client one-click
 * button and the raw link 404'd — the one-click unsubscribe CASL/CAN-SPAM
 * compliance depends on was advertised but non-functional.
 *
 * RFC 8058 requires the POST path to work with no user interaction and no
 * session: mail providers (Gmail, Yahoo, etc.) fire it automatically when a
 * user clicks their native "Unsubscribe" button, authenticated only by the
 * HMAC signature already embedded in the URL by
 * email/unsubscribeUrl.ts:buildProspectUnsubscribeUrl. The GET path is a
 * fallback for a human opening the raw header URL in a browser instead.
 */
import { Router, type Request, type Response } from 'express';
import type { PrismaClient } from '@prisma/client';
import { verifyProspectUnsubscribeRequest } from '../email/unsubscribeUrl.js';
import { isValidPublicUuid, publicJsonError } from '../publicApiHelpers.js';
import { optOutProspect } from '../marketing/prospectEngagement.js';
import { publicLimiter } from '../middleware/rateLimiter.js';

function unsubscribePage(message: string): string {
  const safe = message.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return `<!doctype html>
<html>
<head><meta charset="utf-8"><title>CollectRx</title></head>
<body style="font-family:sans-serif;max-width:480px;margin:80px auto;text-align:center;color:#333">
  <p style="font-size:18px">${safe}</p>
</body>
</html>`;
}

async function handleProspectUnsubscribe(prisma: PrismaClient, req: Request, res: Response, asHtml: boolean): Promise<void> {
  const prospectId = typeof req.query.p === 'string' ? req.query.p : '';
  const signature = typeof req.query.s === 'string' ? req.query.s : undefined;

  if (!prospectId || !isValidPublicUuid(prospectId) || !verifyProspectUnsubscribeRequest(prospectId, signature)) {
    if (asHtml) { res.status(400).send(unsubscribePage('This unsubscribe link is invalid or has expired.')); return; }
    res.status(400).json({ error: 'Invalid unsubscribe link' });
    return;
  }

  try {
    const prospect = await prisma.prospect.findUnique({ where: { id: prospectId }, select: { id: true, optOutAt: true } });
    if (prospect && !prospect.optOutAt) {
      await optOutProspect(prisma, prospectId, 'unsubscribe_link');
    }
    // Same response whether the prospect existed or was already opted out —
    // a valid signature already proves the caller holds a link CollectRx
    // itself generated for this ID, so there's nothing left to leak either way.
    if (asHtml) { res.status(200).send(unsubscribePage("You've been unsubscribed. You won't receive further emails from CollectRx.")); return; }
    res.status(200).json({ success: true });
  } catch (err) {
    console.error('[prospect-unsubscribe]', err);
    const { status, body } = publicJsonError(
      err,
      'Unsubscribe is temporarily unavailable — please try again shortly.',
      'Failed to process the unsubscribe request.',
    );
    if (asHtml) { res.status(status).send(unsubscribePage(body.error)); return; }
    res.status(status).json(body);
  }
}

export function createPublicUnsubscribeRouter(prisma: PrismaClient): Router {
  const r = Router();
  r.use(publicLimiter);

  r.post('/prospect-unsubscribe', (req, res) => { void handleProspectUnsubscribe(prisma, req, res, false); });
  r.get('/prospect-unsubscribe', (req, res) => { void handleProspectUnsubscribe(prisma, req, res, true); });

  return r;
}
