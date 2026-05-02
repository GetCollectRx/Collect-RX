'use strict';
const fs = require('fs');
const path = require('path');

/**
 * electron-builder leaves a CollectRx.app at dist-electron/ root that matches
 * the *last* packaged arch — easy to double-click the wrong binary on Intel vs Apple Silicon.
 */
module.exports = async () => {
  const dist = path.join(__dirname, '..', 'dist-electron');
  const text = `Which CollectRx.app matches YOUR Mac?
────────────────────────────────────────
• Apple Silicon (M1 / M2 / M3 / …)
  → mac-arm64/CollectRx.app
  → or unzip: CollectRx-*-arm64-mac.zip

• Intel Mac (older MacBook Pro / iMac, …)
  → mac/CollectRx.app
  → or unzip: CollectRx-*-mac.zip   (filename has NO "arm64")

If "CollectRx.app" in THIS folder (dist-electron) says not supported, ignore it
and open the app inside mac/ or mac-arm64/ as above.

Railway / hosted dashboard (packaged app opens a URL in the window)
────────────────────────────────────────
The placeholder host often shows Railway "404 / train" — that is not your Mac,
it means the wrong URL or nothing deployed there.

After first launch, create this file with ONE line (your real public URL, no quotes):
  ~/Library/Application Support/dental-ar-system/dashboard-url.txt

Or set env COLLECTRX_DASHBOARD_URL before opening the app (advanced).
Restart CollectRx after saving the file.
`;
  try {
    fs.mkdirSync(dist, { recursive: true });
    fs.writeFileSync(path.join(dist, 'WHICH_APP_TO_OPEN.txt'), text, 'utf8');
  } catch {
    /* non-fatal */
  }
};
