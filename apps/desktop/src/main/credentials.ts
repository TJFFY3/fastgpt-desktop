import { randomUUID } from 'node:crypto';
import type { CredentialRepository } from '../../../../packages/storage/src/index';
import { namespaceKey } from '../../../../packages/storage/src/index';
import type { CredentialState, Namespace } from '../../../../packages/shared/src/index';
export interface SafeStorageBackend {
  isAvailable(): Promise<boolean>;
  isSecure(): Promise<boolean>;
  encrypt(text: string): Promise<Uint8Array>;
  decrypt(data: Uint8Array): Promise<string>;
}
export class SecretStore {
  private memory = new Map<string, string>();
  constructor(private repository: CredentialRepository, private backend: SafeStorageBackend) {}
  private key(ref: string, n: Namespace) { return JSON.stringify([namespaceKey(n), ref]); }
  async put(secret: string, n: Namespace): Promise<{ ref: string; state: 'persistent' | 'session_only' }> {
    const ref = randomUUID(); let ciphertext: Uint8Array | undefined;
    try { if (await this.backend.isAvailable() && await this.backend.isSecure()) ciphertext = await this.backend.encrypt(secret); } catch { /* Fail closed to process memory, never plaintext on disk. */ }
    if (ciphertext) { this.repository.put(n, ref, ciphertext); return { ref, state: 'persistent' }; }
    this.memory.set(this.key(ref, n), secret); return { ref, state: 'session_only' };
  }
  async get(ref: string, n: Namespace): Promise<string | null> {
    const memory = this.memory.get(this.key(ref, n)); if (memory !== undefined) return memory;
    const ciphertext = this.repository.get(n, ref); if (!ciphertext) return null;
    try { if (!await this.backend.isAvailable() || !await this.backend.isSecure()) return null; return await this.backend.decrypt(ciphertext); } catch { return null; }
  }
  status(ref: string, n: Namespace): CredentialState { return this.memory.has(this.key(ref, n)) ? 'session_only' : this.repository.get(n, ref) ? 'persistent' : 'missing'; }
  async remove(ref: string, n: Namespace) { this.memory.delete(this.key(ref, n)); this.repository.remove(n, ref); }
  clearSessionOnly() { this.memory.clear(); }
}
