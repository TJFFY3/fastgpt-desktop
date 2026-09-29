/** Provides the credentials module for the desktop application. */
import { randomUUID } from 'node:crypto';
import type { CredentialRepository } from '../../../../packages/storage/src/index';
import { namespaceKey } from '../../../../packages/storage/src/index';
import type { CredentialState, Namespace } from '../../../../packages/shared/src/index';
/** Describes the safe Storage Backend contract used by this module. */
export interface SafeStorageBackend {
  isAvailable(): Promise<boolean>;
  isSecure(): Promise<boolean>;
  encrypt(text: string): Promise<Uint8Array>;
  decrypt(data: Uint8Array): Promise<string>;
}
/** Coordinates secret Store responsibilities for this module. */
export class SecretStore {
  private memory = new Map<string, string>();
  constructor(
    private repository: CredentialRepository,
    private backend: SafeStorageBackend,
  ) {}
  /** Handles key within this module's workflow. */
  private key(ref: string, n: Namespace) {
    return JSON.stringify([namespaceKey(n), ref]);
  }
  /** Handles put within this module's workflow. */
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
  /** Handles get within this module's workflow. */
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
  /** Handles status within this module's workflow. */
  status(ref: string, n: Namespace): CredentialState {
    return this.memory.has(this.key(ref, n))
      ? 'session_only'
      : this.repository.get(n, ref)
        ? 'persistent'
        : 'missing';
  }
  /** Handles remove within this module's workflow. */
  async remove(ref: string, n: Namespace) {
    this.memory.delete(this.key(ref, n));
    this.repository.remove(n, ref);
  }
  /** Handles clear Session Only within this module's workflow. */
  clearSessionOnly() {
    this.memory.clear();
  }
}
