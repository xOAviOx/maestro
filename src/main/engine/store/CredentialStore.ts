import type { Db } from './Database'
import type { AgentType, CredentialInfo, CredentialKind } from '@shared/types'

/**
 * Symmetric encryption for credentials at rest. In the app this is backed by
 * Electron `safeStorage` (OS keychain). It's an injected interface so the engine
 * stays Electron-free — smoke tests pass a trivial in-memory cipher and run
 * under plain Node.
 */
export interface SecretCipher {
  /** True if encryption is actually available (keychain unlocked, etc.). */
  isAvailable(): boolean
  encrypt(plaintext: string): Buffer
  decrypt(ciphertext: Buffer): string
}

interface CredentialRow {
  agent_type: string
  kind: string
  ciphertext: Buffer
  updated_at: string
}

const KINDS: readonly CredentialKind[] = ['oauth-token', 'api-key']
function isKind(v: string): v is CredentialKind {
  return (KINDS as readonly string[]).includes(v)
}

/**
 * Persists at most one encrypted secret per agent type (the headless/CI
 * fallback). The plaintext secret is write-only from the renderer's view: it can
 * be set and cleared, and main can decrypt it at spawn time, but it's never
 * returned across IPC. `info()` exposes only non-secret metadata.
 */
export class CredentialStore {
  private readonly db: Db
  private readonly cipher: SecretCipher

  constructor(db: Db, cipher: SecretCipher) {
    this.db = db
    this.cipher = cipher
  }

  /** Whether encryption is available on this machine. */
  isEncryptionAvailable(): boolean {
    return this.cipher.isAvailable()
  }

  set(agentType: AgentType, kind: CredentialKind, secret: string): void {
    if (!this.cipher.isAvailable()) {
      throw new Error('Secure storage is unavailable on this machine; cannot store a credential.')
    }
    const ciphertext = this.cipher.encrypt(secret)
    this.db
      .prepare(
        `INSERT INTO agent_credentials (agent_type, kind, ciphertext, updated_at)
         VALUES (@agentType, @kind, @ciphertext, @updatedAt)
         ON CONFLICT(agent_type) DO UPDATE SET
           kind = excluded.kind,
           ciphertext = excluded.ciphertext,
           updated_at = excluded.updated_at`
      )
      .run({
        agentType,
        kind,
        ciphertext,
        updatedAt: new Date().toISOString()
      })
  }

  clear(agentType: AgentType): void {
    this.db.prepare('DELETE FROM agent_credentials WHERE agent_type = ?').run(agentType)
  }

  /** Non-secret metadata for the UI. */
  info(agentType: AgentType): CredentialInfo {
    const row = this.getRow(agentType)
    if (!row) return { agentType, configured: false, kind: null, updatedAt: null }
    return {
      agentType,
      configured: true,
      kind: isKind(row.kind) ? row.kind : null,
      updatedAt: row.updated_at
    }
  }

  /**
   * Decrypt the stored secret for spawn-time env injection (main only). Returns
   * null if none is stored or decryption fails. Never expose the result to the
   * renderer.
   */
  reveal(agentType: AgentType): { kind: CredentialKind; secret: string } | null {
    const row = this.getRow(agentType)
    if (!row || !isKind(row.kind)) return null
    try {
      return { kind: row.kind, secret: this.cipher.decrypt(row.ciphertext) }
    } catch {
      return null
    }
  }

  private getRow(agentType: AgentType): CredentialRow | undefined {
    return this.db
      .prepare('SELECT * FROM agent_credentials WHERE agent_type = ?')
      .get(agentType) as CredentialRow | undefined
  }
}
