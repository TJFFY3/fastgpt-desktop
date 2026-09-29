/** Implements an Electron main-process service or integration boundary. */
import {
  AppError,
  providerDraftSchema,
  type ModelAdapter,
  type ModelProfile,
  type Namespace,
  type ProviderDraft,
  type ProviderView,
} from '../../../../packages/shared/src/index';
import {
  OpenAiChatAdapter,
  normalizeChatEndpoint,
} from '../../../../packages/model-adapter/src/index';
import type { ProviderRepository } from '../../../../packages/storage/src/index';
import type { SecretStore } from './credentials';
/** Owns the module boundary represented by provider Service and coordinates its collaborators. */
export class ProviderService {
  constructor(
    private repository: ProviderRepository,
    private secrets: SecretStore,
    private adapter: ModelAdapter = new OpenAiChatAdapter(),
  ) {}
  /** Implements one focused part of this module’s public responsibility. */
  private view(n: Namespace, profile: ModelProfile): ProviderView {
    const { credentialRef, ...value } = profile;
    return {
      ...value,
      credentialState: credentialRef ? this.secrets.status(credentialRef, n) : 'missing',
    };
  }
  /** Persists or updates state while maintaining this module’s data invariants. */
  async save(
    n: Namespace,
    draft: ProviderDraft,
    apiKey?: string,
    id?: string,
  ): Promise<ProviderView> {
    const value = providerDraftSchema.parse(draft),
      endpoint = normalizeChatEndpoint(value.baseUrl);
    if (endpoint.protocol === 'http:' && !value.allowInsecureHttp)
      throw new AppError('INVALID_INPUT', '明文 HTTP 需要明确许可');
    if (apiKey !== undefined && (!apiKey.trim() || apiKey.length > 16384))
      throw new AppError('INVALID_INPUT', '密钥不能为空或超过长度限制');
    const old = id ? this.repository.get(n, id) : undefined;
    const secret = apiKey !== undefined ? await this.secrets.put(apiKey, n) : undefined;
    let profile: ModelProfile;
    try {
      profile = this.repository.save(n, value, secret?.ref ?? old?.credentialRef ?? null, id);
    } catch (error) {
      if (secret) await this.secrets.remove(secret.ref, n);
      throw error;
    }
    if (secret && old?.credentialRef) await this.secrets.remove(old.credentialRef, n);
    return this.view(n, profile);
  }
  /** Returns data through this module while preserving its ownership and consistency rules. */
  async list(n: Namespace) {
    return this.repository.list(n).map((p) => this.view(n, p));
  }
  /** Implements one focused part of this module’s public responsibility. */
  async resolve(n: Namespace, id: string) {
    const profile = this.repository.get(n, id),
      apiKey = profile.credentialRef ? await this.secrets.get(profile.credentialRef, n) : null;
    if (apiKey === null) throw new AppError('CREDENTIAL_REQUIRED', '请重新填写该模型的 API Key');
    return { profile, apiKey };
  }
  /** Implements one focused part of this module’s public responsibility. */
  async test(n: Namespace, id: string) {
    const resolved = await this.resolve(n, id);
    return this.adapter.probe({
      ...resolved,
      signal: new AbortController().signal,
    });
  }
  /** Releases managed state and prevents further use of the affected resource. */
  async remove(n: Namespace, id: string) {
    const profile = this.repository.get(n, id);
    this.repository.remove(n, id);
    if (profile.credentialRef) await this.secrets.remove(profile.credentialRef, n);
  }
}
