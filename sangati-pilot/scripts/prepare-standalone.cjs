/**
 * prepare-standalone.cjs
 *
 * After `next build` with output:'standalone', pnpm leaves the packages in
 * standalone/apps/web/node_modules/ as absolute symlinks into the pnpm store.
 * electron-builder does not follow absolute symlinks when copying, so those
 * packages are missing from the final exe.
 *
 * This script walks standalone/apps/web/node_modules/, finds every symlink,
 * resolves it to its real path, and replaces it with an actual file copy.
 */

const fs   = require('fs');
const path = require('path');

const standaloneMods = path.join(
  __dirname, '..', 'apps', 'web', '.next', 'standalone', 'apps', 'web', 'node_modules'
);

if (!fs.existsSync(standaloneMods)) {
  console.log('[prepare-standalone] No standalone node_modules found — skipping.');
  process.exit(0);
}

const entries = fs.readdirSync(standaloneMods);
let resolved = 0;

for (const entry of entries) {
  if (entry.startsWith('.')) continue;
  const fullPath = path.join(standaloneMods, entry);
  try {
    const stat = fs.lstatSync(fullPath);
    if (stat.isSymbolicLink()) {
      const real = fs.realpathSync(fullPath);
      console.log(`[prepare-standalone] Resolving: ${entry}`);
      fs.unlinkSync(fullPath);
      fs.cpSync(real, fullPath, { recursive: true });
      resolved++;
    }
  } catch (e) {
    console.error(`[prepare-standalone] Warning — could not resolve ${entry}: ${e.message}`);
  }
}

console.log(`[prepare-standalone] Done — ${resolved} symlink(s) resolved to real copies.`);
