/**
 * Ensure node-pty's macOS/Linux `spawn-helper` prebuild is executable.
 *
 * Some npm/extraction setups unpack the prebuilt binaries without preserving the
 * execute bit. When that happens every `pty.spawn()` fails with the opaque
 * "posix_spawnp failed." — breaking the workspace terminal AND the agent login
 * flow. This restores +x. Safe to run repeatedly; a no-op on Windows.
 */
const fs = require('fs')
const path = require('path')

if (process.platform === 'win32') process.exit(0)

const prebuilds = path.join(__dirname, '..', 'node_modules', 'node-pty', 'prebuilds')
let fixed = 0
try {
  for (const dir of fs.readdirSync(prebuilds)) {
    const helper = path.join(prebuilds, dir, 'spawn-helper')
    if (fs.existsSync(helper)) {
      fs.chmodSync(helper, 0o755)
      fixed += 1
    }
  }
  if (fixed > 0) console.log(`[fix-node-pty] made ${fixed} spawn-helper binary(ies) executable`)
} catch (err) {
  // Don't fail install if node-pty isn't present yet.
  console.warn('[fix-node-pty] skipped:', err.message)
}
