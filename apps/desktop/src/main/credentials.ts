/** Stores provider credentials without exposing plaintext to the renderer or database. */
import { randomUUID } from 'node:crypto';
import type { CredentialRepository } from '../../../../packages/storage/src/index';
import { namespaceKey } from '../../../../packages/storage/src/index';
import type { CredentialState, Namespace } from '../../../../packages/shared/src/index';
/** Abstracts the platform secure-storage service used to encrypt credentials at rest. */
export interface SafeStorageBackend {
  isAvailable(): Promise<boolean>;
  isSecure(): Promise<boolean>;
  encrypt(text: string): Promise<Uint8Array>;
  decrypt(data: Uint8Array): Promise<string>;
}
/** Saves credentials encrypted when secure storage is available, otherwise retains them only for this process session. */
export class SecretStore {
  private memory = new Map<string, string>();
  constructor(
    private repository: CredentialRepository,
    private backend: SafeStorageBackend,
  ) {}
  /** Derives an in-memory key scoped to both a credential reference and namespace. */
  private key(ref: string, n: Namespace) {
    return JSON.stringify([namespaceKey(n), ref]);
  }
  /** Creates a credential reference and writes encrypted bytes or an ephemeral memory-only fallback. */
  async put(
    secret: string,
    n: Namespace,
  ): Promise<{ ref: string; state: 'persistent' | 'session_only' }> {
    const ref = randomUUID();
    let ciphertext: Uint8Array | undefined;
    try {
      if ((await this.backend.isAvailable()) && (await this.backend.isSecure()))
        ciphertext = await this.backend.encrypt(secret);
    } catch {
      /* Fail closed to process memory, never plaintext on disk. */
    }
    if (ciphertext) {
      this.repository.put(n, ref, ciphertext);
      return { ref, state: 'persistent' };
    }
    this.memory.set(this.key(ref, n), secret);
    return { ref, state: 'session_only' };
  }
  /** Resolves a credential only when it belongs to the namespace and can be decrypted securely. */
  async get(ref: string, n: Namespace): Promise<string | null> {
    const memory = this.memory.get(this.key(ref, n));
    if (memory !== undefined) return memory;
    const ciphertext = this.repository.get(n, ref);
    if (!ciphertext) return null;
    try {
      if (!(await this.backend.isAvailable()) || !(await this.backend.isSecure())) return null;
      return await this.backend.decrypt(ciphertext);
    } catch {
      return null;
    }
  }
  /** Reports whether a reference is persisted, session-only, or unavailable without revealing its secret. */
  status(ref: string, n: Namespace): CredentialState {
    return this.memory.has(this.key(ref, n))
      ? 'session_only'
      : this.repository.get(n, ref)
        ? 'persistent'
        : 'missing';
  }
  /** Removes both durable and process-memory representations of a credential reference. */
  async remove(ref: string, n: Namespace) {
    this.memory.delete(this.key(ref, n));
    this.repository.remove(n, ref);
  }
  /** Clears credentials that intentionally never persisted beyond the current session. */
  clearSessionOnly() {
    this.memory.clear();
  }
}
