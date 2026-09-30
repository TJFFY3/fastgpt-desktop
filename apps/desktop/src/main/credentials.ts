/** Stores provider credentials without exposing plaintext to the renderer or database. */
/* 中文：管理模型服务商凭据，避免向渲染进程或数据库暴露明文。 */
import { randomUUID } from 'node:crypto';
import type { CredentialRepository } from '../../../../packages/storage/src/index';
import { namespaceKey } from '../../../../packages/storage/src/index';
import type { CredentialState, Namespace } from '../../../../packages/shared/src/index';
/** Abstracts the platform secure-storage service used to encrypt credentials at rest. */
/* 中文：抽象平台安全存储接口，用于加密保存凭据。 */
export interface SafeStorageBackend {
  isAvailable(): Promise<boolean>;
  isSecure(): Promise<boolean>;
  encrypt(text: string): Promise<Uint8Array>;
  decrypt(data: Uint8Array): Promise<string>;
}
/** Saves credentials encrypted when secure storage is available, otherwise retains them only for this process session. */
/* 中文：安全存储可用时加密保存凭据，否则仅在当前进程会话内保留。 */
export class SecretStore {
  private memory = new Map<string, string>();
  constructor(
    private repository: CredentialRepository,
    private backend: SafeStorageBackend,
  ) {}
  /** Derives an in-memory key scoped to both a credential reference and namespace. */
  /* 中文：组合命名空间和凭据引用，生成隔离不同身份的内存索引键。 */
  private key(ref: string, n: Namespace) {
    return JSON.stringify([namespaceKey(n), ref]);
  }
  /** Creates a credential reference and writes encrypted bytes or an ephemeral memory-only fallback. */
  /* 中文：创建凭据引用；优先保存加密数据，安全存储不可用时退回仅内存保存。 */
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
      /* 中文：安全存储失败时仅保存在进程内存中，绝不将明文写入磁盘。 */
    }
    if (ciphertext) {
      this.repository.put(n, ref, ciphertext);
      return { ref, state: 'persistent' };
    }
    this.memory.set(this.key(ref, n), secret);
    return { ref, state: 'session_only' };
  }
  /** Resolves a credential only when it belongs to the namespace and can be decrypted securely. */
  /* 中文：仅解析属于当前命名空间且能够安全解密的凭据。 */
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
  /* 中文：返回凭据的持久化、仅会话可用或缺失状态，不暴露凭据内容。 */
  status(ref: string, n: Namespace): CredentialState {
    return this.memory.has(this.key(ref, n))
      ? 'session_only'
      : this.repository.get(n, ref)
        ? 'persistent'
        : 'missing';
  }
  /** Removes both durable and process-memory representations of a credential reference. */
  /* 中文：同时删除凭据引用对应的持久化数据和进程内存数据。 */
  async remove(ref: string, n: Namespace) {
    this.memory.delete(this.key(ref, n));
    this.repository.remove(n, ref);
  }
  /** Clears credentials that intentionally never persisted beyond the current session. */
  /* 中文：清除仅保存在当前进程内存中的临时凭据。 */
  clearSessionOnly() {
    this.memory.clear();
  }
}
