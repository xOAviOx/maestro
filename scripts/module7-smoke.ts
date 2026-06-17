/**
 * Module 7 acceptance script.
 *
 * Verifies the agent-account auth detection layer:
 *   1) getClaudeAuthStatus() / getCodexAuthStatus() return well-formed
 *      AgentAuthStatus (never throw), and the schema validates them.
 *   2) getAgentAuthStatus(type) agrees with the per-agent probes.
 *   3) resolveLoginCommand() returns a command iff the CLI is installed, and
 *      cursor (no login flow) always returns null.
 *   4) Headless credential fallback: CredentialStore encrypts at rest, exposes
 *      only non-secret info, reveals the plaintext for spawn injection, refuses
 *      to store when encryption is unavailable, and credentialEnvVar maps each
 *      (agent, kind) to the right env var.
 *
 * Non-destructive: auth probes only READ each CLI's own status; the credential
 * test uses a fake in-memory cipher and a temp DB. Run: `npm run smoke:m7`.
 */
import fs from 'fs'
import os from 'os'
import path from 'path'
import {
  credentialEnvVar,
  getAgentAuthStatus,
  getClaudeAuthStatus,
  getCodexAuthStatus,
  resolveLoginCommand
} from '../src/main/harness'
import { CredentialStore, openDatabase, type SecretCipher } from '../src/main/engine'
import { AgentAuthStatusSchema, CredentialInfoSchema, type AgentAuthStatus } from '../shared/types'

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg)
}

function describe(s: AgentAuthStatus): string {
  return `installed=${s.installed} loggedIn=${s.loggedIn}`
}

async function main(): Promise<void> {
  // 1) Per-agent probes return schema-valid status without throwing.
  const claude = await getClaudeAuthStatus()
  const codex = await getCodexAuthStatus()
  AgentAuthStatusSchema.parse(claude)
  AgentAuthStatusSchema.parse(codex)
  console.log(`Claude Code: ${describe(claude)}`)
  console.log(`Codex:       ${describe(codex)}`)

  assert(claude.agentType === 'claude-code', 'claude status has wrong agentType')
  assert(codex.agentType === 'codex', 'codex status has wrong agentType')
  // Invariant: not-installed implies not-logged-in.
  assert(!(!claude.installed && claude.loggedIn), 'claude: loggedIn while not installed')
  assert(!(!codex.installed && codex.loggedIn), 'codex: loggedIn while not installed')

  // 2) Dispatcher agrees with direct probes.
  const claudeViaDispatch = await getAgentAuthStatus('claude-code')
  assert(
    claudeViaDispatch.installed === claude.installed,
    'getAgentAuthStatus disagrees with getClaudeAuthStatus on installed'
  )
  const cursor = await getAgentAuthStatus('cursor')
  AgentAuthStatusSchema.parse(cursor)
  assert(!cursor.installed && !cursor.loggedIn, 'cursor should be installed=false loggedIn=false')

  // 3) Login command resolution matches install state.
  const claudeLogin = await resolveLoginCommand('claude-code')
  assert(
    (claudeLogin !== null) === claude.installed,
    'claude login command presence must match installed'
  )
  if (claudeLogin) {
    assert(
      claudeLogin.args.join(' ') === 'auth login',
      `unexpected claude login args: ${claudeLogin.args.join(' ')}`
    )
  }
  const codexLogin = await resolveLoginCommand('codex')
  assert(
    (codexLogin !== null) === codex.installed,
    'codex login command presence must match installed'
  )
  if (codexLogin) {
    assert(
      codexLogin.args.join(' ') === 'login',
      `unexpected codex login args: ${codexLogin.args.join(' ')}`
    )
  }
  const cursorLogin = await resolveLoginCommand('cursor')
  assert(cursorLogin === null, 'cursor must have no login command')

  // 4) Credential store round-trip with a reversible fake cipher.
  await testCredentialStore()

  console.log('\nMODULE 7 SMOKE TEST PASSED ✅')
}

/** A reversible, NON-SECURE cipher for the test only (XOR + base64). */
function fakeCipher(available = true): SecretCipher {
  const KEY = 0x5a
  return {
    isAvailable: () => available,
    encrypt: (plaintext) => Buffer.from([...Buffer.from(plaintext, 'utf8')].map((b) => b ^ KEY)),
    decrypt: (ciphertext) =>
      Buffer.from([...ciphertext].map((b) => b ^ KEY)).toString('utf8')
  }
}

async function testCredentialStore(): Promise<void> {
  const dbPath = path.join(os.tmpdir(), `maestro-m7-${process.pid}.db`)
  try {
    // env-var mapping.
    assert(
      credentialEnvVar('claude-code', 'oauth-token') === 'CLAUDE_CODE_OAUTH_TOKEN',
      'claude oauth-token env var wrong'
    )
    assert(
      credentialEnvVar('claude-code', 'api-key') === 'ANTHROPIC_API_KEY',
      'claude api-key env var wrong'
    )
    assert(credentialEnvVar('codex', 'api-key') === 'OPENAI_API_KEY', 'codex api-key env var wrong')
    assert(credentialEnvVar('codex', 'oauth-token') === null, 'codex oauth-token should be null')

    const db = openDatabase(dbPath)
    const store = new CredentialStore(db, fakeCipher())

    // Empty state.
    let info = store.info('claude-code')
    CredentialInfoSchema.parse(info)
    assert(!info.configured && info.kind === null, 'fresh credential should be unconfigured')
    assert(store.reveal('claude-code') === null, 'reveal on empty must be null')

    // Set + reveal.
    const secret = 'sk-test-abc123'
    store.set('claude-code', 'oauth-token', secret)
    info = store.info('claude-code')
    assert(info.configured && info.kind === 'oauth-token', 'configured info wrong after set')
    const revealed = store.reveal('claude-code')
    assert(revealed?.secret === secret, 'revealed secret does not round-trip')
    assert(revealed?.kind === 'oauth-token', 'revealed kind wrong')

    // Ciphertext at rest must NOT equal plaintext.
    const rawRow = db
      .prepare('SELECT ciphertext FROM agent_credentials WHERE agent_type = ?')
      .get('claude-code') as { ciphertext: Buffer }
    assert(
      Buffer.isBuffer(rawRow.ciphertext) && rawRow.ciphertext.toString('utf8') !== secret,
      'secret was stored in plaintext (must be encrypted at rest)'
    )

    // Clear.
    store.clear('claude-code')
    assert(!store.info('claude-code').configured, 'credential should be gone after clear')

    // Unavailable cipher refuses to persist.
    const lockedStore = new CredentialStore(db, fakeCipher(false))
    let refused = false
    try {
      lockedStore.set('codex', 'api-key', 'nope')
    } catch {
      refused = true
    }
    assert(refused, 'set must throw when encryption is unavailable')
    assert(!store.info('codex').configured, 'nothing should persist when encryption unavailable')

    db.close()
    console.log('Credential store: encrypt-at-rest + reveal + clear + locked-refusal OK')
  } finally {
    for (const suffix of ['', '-wal', '-shm']) {
      try {
        fs.rmSync(`${dbPath}${suffix}`, { force: true })
      } catch {
        // ignore
      }
    }
  }
}

main().catch((err: unknown) => {
  console.error('\nMODULE 7 SMOKE TEST FAILED ❌')
  console.error(err)
  process.exitCode = 1
})
