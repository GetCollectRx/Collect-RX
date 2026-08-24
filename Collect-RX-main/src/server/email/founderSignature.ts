/**
 * The one signature block every outbound CollectRx email closes with —
 * marketing/outreach and product/transactional alike. Also the real CASL
 * mailing address (s.6(2) requires one on every commercial electronic
 * message); keeping it here means there's exactly one place to update it.
 */

export const FOUNDER_SIGNATURE_LINES = [
  'Khalid Egeh',
  'Founder',
  '',
  'CollectRx',
  '499 Preston St.',
  'Ottawa, ON',
  'K1S 4N7',
] as const;

export const FOUNDER_SIGNATURE_TEXT = FOUNDER_SIGNATURE_LINES.join('\n');

export const FOUNDER_SIGNATURE_HTML = FOUNDER_SIGNATURE_LINES.map((line) => line || '&nbsp;').join('<br>\n');
