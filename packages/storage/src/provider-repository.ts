/** Implements namespaced durable storage and record conversion for desktop state. */
/* 中文：按命名空间隔离桌面状态的持久化存储，并转换数据库记录。 */
import { randomUUID } from 'node:crypto';
import {
  AppError,
  providerDraftSchema,
  modelProfileSchema,
  type ModelProfile,
  type Namespace,
  type ProviderDraft,
} from '../../shared/src/index';
import type { Database } from './database';
import { namespaceKey } from './namespace';
/** Owns the module boundary represented by provider Repository and coordinates its collaborators. */
/* 中文：持久化模型服务商配置并按命名空间查询。 */
export class ProviderRepository {
  constructor(private db: Database) {}
  /* 中文：保存显式远程执行目标，复用同一应用和凭据的配置但绝不存储明文密钥。 */
  createRemote(
    n: Namespace,
    name: string,
    baseUrl: string,
    appId: string,
    credentialRef: string,
  ): ModelProfile {
    const existing = this.list(n).find(
      (p) =>
        p.fastgpt?.appId === appId && p.baseUrl === baseUrl && p.credentialRef === credentialRef,
    );
    if (existing) return existing;
    const profile = modelProfileSchema.parse({
      id: randomUUID(),
      revision: randomUUID(),
      name: name.slice(0, 100),
      baseUrl,
      modelId: appId,
      credentialRef,
      fastgpt: { appId },
      contextWindow: 32768,
      maxOutputTokens: 4096,
      timeoutMs: 600000,
      capabilities: {
        tools: false,
        temperature: false,
        outputTokenField: 'max_tokens',
        reasoningField: 'none',
      },
    });
    this.db.raw
      .prepare('INSERT INTO providers(namespace_key,id,data) VALUES(?,?,?)')
      .run(namespaceKey(n), profile.id, JSON.stringify(profile));
    return profile;
  }
  /** Persists or updates state while maintaining this module’s data invariants. */
  /* 中文：保存或更新状态，同时维持本模块的数据一致性约束。 */
  save(
    n: Namespace,
    draft: ProviderDraft,
    credentialRef: string | null,
    id?: string,
  ): ModelProfile {
    if (id && this.get(n, id).fastgpt)
      throw new AppError('REMOTE_TARGET_FIXED', '远程应用不能作为本地模型编辑');
    /** Captures domain configuration or protocol data whose fields are consumed together by this module. */
    /* 中文：组织本模块需要共同使用的业务配置或协议数据。 */
    const profile = {
      ...providerDraftSchema.parse(draft),
      id: id ?? randomUUID(),
      credentialRef,
      revision: randomUUID(),
    };
    this.db.raw
      .prepare(
        'INSERT INTO providers(namespace_key,id,data) VALUES(?,?,?) ON CONFLICT(namespace_key,id) DO UPDATE SET data=excluded.data',
      )
      .run(namespaceKey(n), profile.id, JSON.stringify(profile));
    return profile;
  }
  /** Returns data through this module while preserving its ownership and consistency rules. */
  /* 中文：按本模块的归属校验和一致性规则查询并返回数据。 */
  get(n: Namespace, id: string): ModelProfile {
    const row = this.db.raw
      .prepare('SELECT data FROM providers WHERE namespace_key=? AND id=?')
      .get(namespaceKey(n), id);
    if (!row) throw new AppError('NOT_FOUND', '模型配置不存在');
    return modelProfileSchema.parse(JSON.parse(row.data as string));
  }
  /** Returns data through this module while preserving its ownership and consistency rules. */
  /* 中文：按本模块的归属校验和一致性规则查询并返回数据。 */
  list(n: Namespace): ModelProfile[] {
    return this.db.raw
      .prepare('SELECT data FROM providers WHERE namespace_key=? ORDER BY rowid')
      .all(namespaceKey(n))
      .map((r) => modelProfileSchema.parse(JSON.parse(r.data as string)));
  }
  /** Releases managed state and prevents further use of the affected resource. */
  /* 中文：释放受管理的状态，并阻止继续使用已失效的资源。 */
  remove(n: Namespace, id: string) {
    this.get(n, id);
    if (
      this.db.raw
        .prepare('SELECT 1 FROM sessions WHERE namespace_key=? AND provider_id=?')
        .get(namespaceKey(n), id)
    )
      throw new AppError('INVALID_INPUT', '请先删除使用该模型的会话');
    this.db.raw
      .prepare('DELETE FROM providers WHERE namespace_key=? AND id=?')
      .run(namespaceKey(n), id);
  }
}
