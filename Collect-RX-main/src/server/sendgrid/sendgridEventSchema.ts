/**
 * Zod schema for SendGrid Event Webhook payloads.
 *
 * SendGrid delivers a JSON array of events per POST, sizes range from one to
 * several thousand. A single malformed or unexpectedly-shaped element must
 * never take down the whole batch (or the process) — every field on
 * `SgEvent` here is read with plain property access downstream, so a
 * non-object entry (e.g. `null`, a bare string) previously threw a
 * TypeError from inside an unguarded async route handler, which is an
 * unhandled promise rejection under this app's `process.on('unhandledRejection')`
 * handler and crashes the whole server, not just the one request.
 */
import { z } from 'zod';

export const sendgridEventSchema = z
  .object({
    email: z.string().optional(),
    event: z.string().optional(),
    reason: z.string().optional(),
    url: z.string().optional(),
    sg_message_id: z.string().optional(),
    /** custom_args from SendGrid v3 */
    prospect_id: z.string().optional(),
    campaign_id: z.string().optional(),
    template_id: z.string().optional(),
  })
  // SendGrid events carry many more standard fields (timestamp, sg_event_id,
  // category, ip, useragent, ...) that this handler doesn't read. Passthrough
  // rather than strict so we validate only what we consume without rejecting
  // otherwise-legitimate events over fields we ignore.
  .passthrough();

export type SendgridEvent = z.infer<typeof sendgridEventSchema>;

/**
 * A batch is valid at the transport level once it's a JSON array — each
 * element is validated independently by the caller so one malformed event
 * doesn't cause the entire (potentially large) batch to be dropped and
 * retried forever.
 */
export const sendgridEventBatchSchema = z.array(z.unknown());
