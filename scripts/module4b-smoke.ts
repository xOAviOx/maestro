/**
 * Module 4b acceptance script.
 *
 * Drives the PtyManager directly (no UI): spawns a real shell, writes a command,
 * confirms the output streams back through the data sink, then disposes and
 * confirms the exit sink fires. Proves the node-pty layer end-to-end.
 *
 * Uses node-pty's N-API prebuild (works under plain Node and Electron alike).
 * Run: `npm run smoke:m4b`.
 */
import os from 'os'
import assert from 'assert'
import { PtyManager } from '../src/main/terminal/PtyManager'

const delay = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

async function waitFor(pred: () => boolean, timeoutMs: number): Promise<boolean> {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    if (pred()) return true
    await delay(100)
  }
  return pred()
}

async function main(): Promise<void> {
  let output = ''
  let exited = false
  let exitCode: number | null = null

  const mgr = new PtyManager(
    (e) => {
      output += e.data
    },
    (e) => {
      exited = true
      exitCode = e.exitCode
    }
  )

  const wsId = 'pty-smoke'
  const marker = `MAESTRO_PTY_OK_${Date.now()}`

  console.log('Spawning shell in', os.tmpdir())
  mgr.start(wsId, os.tmpdir(), 80, 24)

  // Let the shell initialize, then run an echo and submit with Enter.
  await delay(1000)
  mgr.write(wsId, `echo ${marker}\r`)

  const sawMarker = await waitFor(() => output.includes(marker), 15000)
  console.log('Saw marker in streamed output?', sawMarker)
  assert(sawMarker, 'PTY did not stream back the echoed marker')

  // Resize should not throw.
  mgr.resize(wsId, 100, 30)

  mgr.dispose(wsId)
  const sawExit = await waitFor(() => exited, 6000)
  console.log('Exit sink fired?', sawExit, 'exitCode=', exitCode)
  assert(sawExit, 'Exit sink did not fire after dispose')

  console.log('\nMODULE 4b SMOKE TEST PASSED ✅')
}

main()
  .then(() => process.exit(0))
  .catch((err: unknown) => {
    console.error('\nMODULE 4b SMOKE TEST FAILED ❌')
    console.error(err)
    process.exit(1)
  })
