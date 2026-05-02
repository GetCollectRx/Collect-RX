'use strict';
/**
 * npm workspaces hoist `electron` to the monorepo root. electron-builder resolves
 * the Electron version from the app package directory, so we link hoisted
 * `electron` into this workspace's node_modules when missing.
 */
const fs = require('fs');
const path = require('path');

const pkgRoot = path.resolve(__dirname, '..');
const monoRoot = path.resolve(pkgRoot, '..');
const hoisted = path.join(monoRoot, 'node_modules', 'electron');
const localParent = path.join(pkgRoot, 'node_modules');
const localElectron = path.join(localParent, 'electron');

function main() {
  if (!fs.existsSync(hoisted)) {
    console.warn(
      '[ensure-electron-symlink] Skipping: no hoisted electron at',
      hoisted
    );
    return;
  }

  fs.mkdirSync(localParent, { recursive: true });

  if (fs.existsSync(localElectron)) {
    try {
      const st = fs.lstatSync(localElectron);
      if (st.isSymbolicLink() || st.isDirectory()) return;
    } catch {
      /* replace broken link */
    }
    fs.rmSync(localElectron, { recursive: true, force: true });
  }

  if (process.platform === 'win32') {
    fs.symlinkSync(hoisted, localElectron, 'junction');
  } else {
    fs.symlinkSync(hoisted, localElectron, 'dir');
  }
  console.log('[ensure-electron-symlink]', localElectron, '->', hoisted);
}

main();
