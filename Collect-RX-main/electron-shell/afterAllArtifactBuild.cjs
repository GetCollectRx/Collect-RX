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
The default host is https://www.collectrx.ca. If you use a custom deployment,
set dashboard-url.txt or COLLECTRX_DASHBOARD_URL (see electron/main.js).
`;
  try {
    fs.mkdirSync(dist, { recursive: true });
    fs.writeFileSync(path.join(dist, 'WHICH_APP_TO_OPEN.txt'), text, 'utf8');
  } catch {
    /* non-fatal */
  }
};
