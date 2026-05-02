'use strict';
/**
 * Strip extended attributes before codesign. Avoids
 * "resource fork, Finder information, or similar detritus not allowed"
 * on some macOS / Desktop-synced trees.
 */
const { execFileSync } = require('child_process');

module.exports = async (context) => {
  const appOutDir = context.appOutDir;
  if (!appOutDir) return;
  try {
    execFileSync('xattr', ['-cr', appOutDir], { stdio: 'inherit' });
  } catch {
    /* non-fatal */
  }
};
