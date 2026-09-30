/** Queries FastGPT resource catalogs through a credential-owning main-process boundary. */
/* 中文：主进程持有凭据，按 FastGPT 服务端权限查询应用与知识库；不代替用户登录或 SSO。 */
import { z } from 'zod';
import {
  AppError,
  type FastGptCatalogQuery,
  type FastGptConnection,
  type FastGptResource,
  type Namespace,
} from '../../../../packages/shared/src/index';
import type { FastGptRepository } from '../../../../packages/storage/src/fastgpt-repository';
import type { SecretStore } from './credentials';
import { namespaceKey, type Store } from '../../../../packages/storage/src/index';
const defaultUrl = 'https://cloud.fastgpt.cn/api';
const responseSchema = z.object({
  code: z.literal(200),
  data: z.object({
    total: z.number().int().nonnegative(),
    list: z.array(
      z.object({
        _id: z.string().regex(/^[a-f\d]{24}$/i),
        name: z.string(),
        intro: z.string().optional().default(''),
        type: z.string(),
        permission: z.object({ hasReadPer: z.literal(true) }),
      }),
    ),
  }),
});
/* 中文：连接操作串行化，避免重复保存导致凭据引用或删除状态不一致。 */
export class FastGptService {
  private mutation: Promise<unknown> = Promise.resolve();
  // 中文：只缓存主进程从可读目录取得的元数据；绑定身份和凭据，不信任页面传入的应用名称。
  private catalogApps = new Map<string, { ref: string; resource: FastGptResource }>();
  constructor(
    private repository: FastGptRepository,
    private secrets: SecretStore,
    private request: typeof fetch = fetch,
    private store?: Store,
    private beforeConnectionChange: (n: Namespace) => Promise<void> = async () => {},
  ) {}
  /* 中文：使用服务端可读目录或当前连接已建立的固定目标创建会话；执行权限由对话接口校验。 */
  async createSession(n: Namespace, appId: string) {
    if (!this.store) throw new AppError('INTERNAL', '会话存储未初始化');
    const id = z
      .string()
      .regex(/^[a-f\d]{24}$/i)
      .parse(appId);
    const config = this.repository.get(n);
    const key = config ? await this.secrets.get(config.ref, n) : null;
    if (!config || !key) throw new AppError('CREDENTIAL_MISSING', '请先连接 FastGPT');
    if (this.repository.get(n)?.ref !== config.ref)
      throw new AppError('STALE_CONNECTION', '连接已变更，请重新选择应用');
    const cached = this.catalogApps.get(`${namespaceKey(n)}:${id}`);
    const existing = this.store.providers
      .list(n)
      .find((profile) => profile.fastgpt?.appId === id && profile.credentialRef === config.ref);
    const resource = cached?.ref === config.ref ? cached.resource : undefined;
    if (resource && !['simple', 'chatAgent', 'advanced'].includes(resource.type))
      throw new AppError('FASTGPT_REQUEST', '该资源不是可用的对话应用');
    const name = resource?.name ?? existing?.name;
    if (!name) throw new AppError('FASTGPT_REQUEST', '请在 Agent 广场刷新目录并重新选择可读的应用');
    return this.store.transaction(() => {
      const profile = this.store!.providers.createRemote(
        n,
        name,
        config.baseUrl + '/v1',
        id,
        config.ref,
      );
      return this.store!.sessions.create(n, { providerId: profile.id, title: '新会话' });
    });
  }
  /* 中文：仅接受明确的 HTTPS API 根地址，禁止凭据、查询参数和重定向。 */
  private normalize(value: string) {
    let url: URL;
    try {
      url = new URL(value);
    } catch {
      throw new AppError('INVALID_INPUT', 'FastGPT 地址无效');
    }
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash)
      throw new AppError('INVALID_INPUT', '请使用不包含凭据、参数的 HTTPS API 地址');
    return url.toString().replace(/\/+$/, '');
  }
  /* 中文：返回地址和凭据状态，不泄露 API Key。 */
  connection(n: Namespace): FastGptConnection {
    const config = this.repository.get(n);
    return {
      baseUrl: config?.baseUrl ?? defaultUrl,
      credentialState: config ? this.secrets.status(config.ref, n) : 'missing',
    };
  }
  /* 中文：加密保存新凭据，成功替换后清理旧凭据。 */
  save(n: Namespace, baseUrl: string, apiKey: string) {
    const endpoint = this.normalize(baseUrl);
    if (!apiKey.trim() || apiKey.length > 8192)
      throw new AppError('INVALID_INPUT', 'API Key 不能为空或超过长度限制');
    const operation = this.mutation.then(async () => {
      const old = this.repository.get(n);
      // 中文：先关闭启动入口，再等待旧请求停止，避免等待期间提交旧凭据的任务。
      this.repository.remove(n);
      let secret: Awaited<ReturnType<SecretStore['put']>> | undefined;
      try {
        await this.beforeConnectionChange(n);
        secret = await this.secrets.put(apiKey.trim(), n);
        this.repository.save(n, endpoint, secret.ref);
      } catch (e) {
        if (old) this.repository.save(n, old.baseUrl, old.ref);
        if (secret) await this.secrets.remove(secret.ref, n);
        throw e;
      }
      if (old) await this.secrets.remove(old.ref, n);
      return this.connection(n);
    });
    this.mutation = operation.catch(() => {});
    return operation;
  }
  /* 中文：清理连接和安全存储中的凭据。 */
  disconnect(n: Namespace) {
    const operation = this.mutation.then(async () => {
      const old = this.repository.get(n);
      this.repository.remove(n);
      try {
        await this.beforeConnectionChange(n);
      } catch (error) {
        if (old) this.repository.save(n, old.baseUrl, old.ref);
        throw error;
      }
      if (old) await this.secrets.remove(old.ref, n);
    });
    this.mutation = operation.catch(() => {});
    return operation;
  }
  /* 中文：查询分页目录；只返回服务端认可的可读资源，失败时不使用本地模型伪装结果。 */
  async list(n: Namespace, query: FastGptCatalogQuery) {
    const config = this.repository.get(n);
    const key = config ? await this.secrets.get(config.ref, n) : null;
    if (!config || !key) throw new AppError('CREDENTIAL_MISSING', '请先连接 FastGPT');
    const route = query.kind === 'agents' ? '/core/app/listV2' : '/core/dataset/listV2';
    let response: Response;
    try {
      response = await this.request(this.normalize(config.baseUrl) + route, {
        method: 'POST',
        redirect: 'error',
        signal: AbortSignal.timeout(15000),
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          parentId: query.parentId ?? null,
          searchKey: query.searchKey ?? '',
          offset: query.offset ?? 0,
          pageSize: 30,
          ...(query.kind === 'agents'
            ? { type: ['folder', 'simple', 'chatAgent', 'advanced'] }
            : {}),
        }),
      });
    } catch {
      throw new AppError('NETWORK', 'FastGPT 连接失败或超时，请检查网络与服务地址');
    }
    if (!response.ok)
      throw new AppError(
        'FASTGPT_REQUEST',
        response.status === 401 || response.status === 403
          ? 'FastGPT 凭据无效或权限不足'
          : 'FastGPT 服务暂不可用',
      );
    const raw = await this.readJson(response);
    if ((raw as { code?: number })?.code !== 200)
      throw new AppError('FASTGPT_REQUEST', 'FastGPT 拒绝查询，请检查 API Key 和资源访问权限');
    const result = responseSchema.safeParse(raw);
    if (!result.success)
      throw new AppError('FASTGPT_RESPONSE', 'FastGPT 列表格式或权限信息不符合接口规范');
    if (this.repository.get(n)?.ref !== config.ref)
      throw new AppError('STALE_CONNECTION', '连接已变更，请刷新列表');
    const list = result.data.data.list.map((item) => ({
      id: item._id,
      name: item.name,
      intro: item.intro,
      type: item.type,
      folder: item.type === 'folder',
    }));
    if (query.kind === 'agents') {
      for (const resource of list) {
        const cacheKey = `${namespaceKey(n)}:${resource.id}`;
        this.catalogApps.delete(cacheKey);
        this.catalogApps.set(cacheKey, { ref: config.ref, resource });
        // 中文：限制内存目录缓存规模，淘汰的条目可通过刷新目录重新取得。
        if (this.catalogApps.size > 2000)
          this.catalogApps.delete(this.catalogApps.keys().next().value!);
      }
    }
    return { total: result.data.data.total, list };
  }
  /* 中文：限制远端响应大小，并只使用本地生成的错误提示，避免泄露服务端敏感内容。 */
  private async readJson(response: Response): Promise<unknown> {
    let bytes = 0;
    const chunks: Uint8Array[] = [];
    const reader = response.body?.getReader();
    if (!reader) throw new AppError('FASTGPT_RESPONSE', 'FastGPT 响应为空');
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        bytes += value.length;
        if (bytes > 4 * 1024 * 1024) {
          await reader.cancel();
          throw new AppError('FASTGPT_RESPONSE', 'FastGPT 响应过大');
        }
        chunks.push(value);
      }
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError('NETWORK', 'FastGPT 响应读取失败，请重试');
    } finally {
      reader.releaseLock();
    }
    let raw: unknown;
    try {
      raw = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    } catch {
      throw new AppError('FASTGPT_RESPONSE', 'FastGPT 响应格式无效');
    }
    return raw;
  }
}
