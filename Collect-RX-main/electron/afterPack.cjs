'use strict';
/**
 * Runs after the .app is assembled, immediately before @electron/osx-sign.
 * Clears metadata that makes `codesign` fail with:
 *   "resource fork, Finder information, or similar detritus not allowed"
 * (common when the project or output lives under Desktop / iCloud Drive.)
 */
const { execFileSync } = require('child_process');
const path = require('path');
const fs = require('fs');

function stripDetritus(appPath) {
  execFileSync('xattr', ['-cr', appPath], { stdio: 'inherit' });
  try {
    execFileSync('dot_clean', ['-m', appPath], { stdio: 'pipe' });
  } catch {
    /* non-fatal */
  }
  try {
    execFileSync('find', [appPath, '-name', '._*', '-delete'], { stdio: 'pipe' });
  } catch {
    /* non-fatal */
  }
  execFileSync('xattr', ['-cr', appPath], { stdio: 'inherit' });
}

module.exports = async (context) => {
  const appOutDir = context.appOutDir;
  if (!appOutDir) return;

  const productName = context.packager.appInfo.productName;
  const appPath = path.join(appOutDir, `${productName}.app`);
  if (!fs.existsSync(appPath)) {
    console.warn(`[afterPack] Expected app missing, skip strip: ${appPath}`);
    return;
  }

  console.log(`[afterPack] Strip Finder / AppleDouble metadata before codesign: ${appPath}`);
  stripDetritus(appPath);
};
