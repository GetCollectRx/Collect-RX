/**
 * Branded HTML wrapper for partnership outreach — aligned with collectrx.ca tokens.
 * Table layout for email client compatibility.
 */

const BRAND = {
  cream: '#fcfcfa',
  parchment: '#f8f5ee',
  ink: '#1f1f1f',
  graphite: '#60605f',
  green: '#0f9d58',
  greenDark: '#0b5b47',
  border: 'rgba(31,31,31,0.10)',
} as const;

const LOGO_URL = process.env.MARKETING_LOGO_URL || 'https://www.collectrx.ca/og-image.png';
const SITE_URL = process.env.MARKETING_SITE_URL || 'https://www.collectrx.ca';
const MAILING_ADDRESS = process.env.MARKETING_MAILING_ADDRESS || 'PO Box [TBD], Toronto, ON';

export interface OutreachEmailLayoutOptions {
  /** Inner HTML — paragraphs, lists, etc. CTA may be included in body or passed separately. */
  bodyHtml: string;
  /** Shown in inbox preview where supported */
  preheader?: string;
  /** Optional green button below body */
  cta?: { label: string; href: string };
}

export function wrapOutreachEmail(opts: OutreachEmailLayoutOptions): string {
  const { bodyHtml, preheader, cta } = opts;

  const ctaBlock = cta
    ? `<tr>
        <td style="padding:8px 32px 24px;">
          <a href="${escapeAttr(cta.href)}"
             style="display:inline-block;background:${BRAND.green};color:${BRAND.cream};
                    text-decoration:none;font-family:Inter,system-ui,sans-serif;font-size:16px;
                    font-weight:500;padding:12px 24px;border-radius:8px;">
            ${escapeHtml(cta.label)}
          </a>
        </td>
      </tr>`
    : '';

  const preheaderBlock = preheader
    ? `<div style="display:none;max-height:0;overflow:hidden;mso-hide:all;">${escapeHtml(preheader)}</div>`
    : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>CollectRx</title>
</head>
<body style="margin:0;padding:0;background:${BRAND.parchment};">
  ${preheaderBlock}
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${BRAND.parchment};">
    <tr>
      <td align="center" style="padding:32px 16px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0"
               style="max-width:560px;background:${BRAND.cream};border:1px solid ${BRAND.border};border-radius:16px;">
          <tr>
            <td style="padding:28px 32px 16px;">
              <a href="${escapeAttr(SITE_URL)}" style="text-decoration:none;display:inline-flex;align-items:center;gap:10px;">
                <img src="${escapeAttr(LOGO_URL)}" alt="CollectRx" width="32" height="32"
                     style="display:block;border-radius:8px;" />
                <span style="font-family:Inter,system-ui,sans-serif;font-size:16px;font-weight:600;color:${BRAND.ink};">
                  Collect<span style="color:${BRAND.green};">Rx</span>
                </span>
              </a>
            </td>
          </tr>
          <tr>
            <td style="padding:0 32px 8px;font-family:Inter,system-ui,sans-serif;font-size:16px;line-height:1.56;color:${BRAND.ink};">
              ${bodyHtml}
            </td>
          </tr>
          ${ctaBlock}
          <tr>
            <td style="padding:16px 32px 28px;border-top:1px solid ${BRAND.border};">
              <p style="margin:0;font-family:Inter,system-ui,sans-serif;font-size:13px;line-height:1.5;color:${BRAND.graphite};">
                Khalid Egeh | CollectRx | ${escapeHtml(MAILING_ADDRESS)}<br />
                <a href="${escapeAttr(SITE_URL)}" style="color:${BRAND.greenDark};">collectrx.ca</a><br /><br />
                To stop receiving emails from CollectRx, reply with &ldquo;unsubscribe&rdquo; in the subject line.
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function escapeAttr(s: string): string {
  return escapeHtml(s).replace(/'/g, '&#39;');
}
