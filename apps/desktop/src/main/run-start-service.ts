/** Implements an Electron main-process service or integration boundary. */
/* 中文：实现 Electron 主进程服务及其与其他模块的集成接口。 */
import {
  AppError,
  modelSnapshotSchema,
  runStartSchema,
  type ChatMessage,
  type MessageRecord,
  type ModelProfile,
  type Namespace,
  type RunStartRequest,
  type ToolSpec,
} from '../../../../packages/shared/src/index';
import { activeStatuses, namespaceKey, type Store } from '../../../../packages/storage/src/index';
import type { ProviderService } from './provider-service';

/** Complete rounds only: never send partial responses or orphaned tool results. */
/* 中文：只发送完整对话轮次，排除未完成的响应及没有对应调用的工具结果。 */
export function modelHistory(records: MessageRecord[]): ChatMessage[] {
  const result: ChatMessage[] = [];
  for (let i = 0; i < records.length; i++) {
    const r = records[i];
    if (r.status !== 'complete' || r.role === 'tool') continue;
    /** Captures domain configuration or protocol data whose fields are consumed together by this module. */
    /* 中文：组织本模块需要共同使用的业务配置或协议数据。 */
    const message: ChatMessage = {
      role: r.role,
      content: r.content,
      ...(r.toolCalls ? { toolCalls: r.toolCalls } : {}),
      ...(r.toolCallId ? { toolCallId: r.toolCallId } : {}),
    };
    if (!r.toolCalls) {
      result.push(message);
      continue;
    }
    const following = records.slice(i + 1, i + 1 + r.toolCalls.length);
    if (
      following.length === r.toolCalls.length &&
      following.every(
        (m, j) =>
          m.status === 'complete' && m.role === 'tool' && m.toolCallId === r.toolCalls![j].id,
      )
    ) {
      result.push(
        message,
        ...following.map((m) => ({
          role: 'tool' as const,
          content: m.content,
          toolCallId: m.toolCallId,
        })),
      );
      i += following.length;
    }
  }
  return result;
}
/** Defines the data shape exchanged through this module without exposing its implementation. */
/* 中文：定义模块间传递的数据结构，隐藏内部实现细节。 */
export type ContextPreparer = (
  n: Namespace,
  request: RunStartRequest,
  profile: ModelProfile,
  tools: ToolSpec[],
) => Promise<ChatMessage[]>;
/** Owns the module boundary represented by run Start Service and coordinates its collaborators. */
/* 中文：准备启动上下文，并在配置一致的前提下创建运行记录。 */
export class RunStartService {
  constructor(
    private store: Store,
    private providers: ProviderService,
    private principal: () => Namespace,
    private tools: () => ToolSpec[],
    private prepareContext: ContextPreparer = async (n, request) => [
      ...modelHistory(this.store.sessions.messages(n, request.sessionId)),
      { role: 'user', content: request.text || '已添加文件' },
    ],
  ) {}
  /** Initializes the module operation and connects it to its required lifecycle dependencies. */
  /* 中文：初始化模块操作，并连接执行所需的生命周期依赖。 */
  async prepare(n: Namespace, input: RunStartRequest) {
    const request = runStartSchema.parse(input),
      key = namespaceKey(n);
    /** Implements one focused part of this module’s public responsibility. */
    /* 中文：实现本模块职责中的一项具体操作。 */
    const identity = () => {
      if (namespaceKey(this.principal()) !== key)
        throw new AppError('PERMISSION_DENIED', '当前身份已失效');
    };
    identity();
    const session = this.store.sessions.get(n, request.sessionId),
      profile = this.store.providers.get(n, session.providerId),
      workspace = this.store.workspaces.getForSession(n, session.id);
    if (profile.fastgpt && request.attachmentIds.length)
      throw new AppError('REMOTE_ATTACHMENTS_UNSUPPORTED', '远程应用当前仅支持文本对话');
    /** Validates or normalizes untrusted input before it crosses this module boundary. */
    /* 中文：在不可信输入进入模块前执行校验或规范化处理。 */
    const validate = () => {
      identity();
      const current = this.store.sessions.get(n, session.id),
        model = this.store.providers.get(n, session.providerId),
        ws = this.store.workspaces.getForSession(n, session.id);
      if (current.archived) throw new AppError('SESSION_ARCHIVED', '请先取消归档再继续对话');
      // 中文：远端会话绑定创建时的连接，异步读取凭据及提交前均拒绝已替换的目标。
      if (profile.fastgpt && this.store.fastgpt.get(n)?.ref !== profile.credentialRef)
        throw new AppError('CONFIG_CHANGED', 'FastGPT 连接已变化，请从 Agent 广场重新开始对话');
      if (
        current.revision !== session.revision ||
        current.providerId !== profile.id ||
        model.revision !== profile.revision ||
        ws?.id !== workspace?.id ||
        ws?.revision !== workspace?.revision ||
        (request.expectedSessionRevision !== undefined &&
          current.revision !== request.expectedSessionRevision) ||
        (request.expectedWorkspaceRevision !== undefined &&
          (ws?.revision ?? 0) !== request.expectedWorkspaceRevision)
      )
        throw new AppError('CONFIG_CHANGED', '配置已变化，请重新发送');
      if (this.store.runs.list(n, session.id).some((r) => activeStatuses.includes(r.status)))
        throw new AppError('RUN_ACTIVE', '会话已有正在执行的任务');
    };
    validate();
    const resolved = await this.providers.resolve(n, profile.id);
    validate();
    if (resolved.profile.revision !== profile.revision)
      throw new AppError('CONFIG_CHANGED', '模型配置已变化');
    const tools = profile.capabilities.tools ? this.tools() : [];
    const messages = profile.fastgpt
      ? [{ role: 'user' as const, content: request.text }]
      : await this.prepareContext(n, request, profile, tools);
    validate();
    const snapshot = modelSnapshotSchema.parse({
      providerId: profile.id,
      ...(profile.fastgpt ? { fastgpt: profile.fastgpt } : {}),
      revision: profile.revision,
      name: profile.name,
      baseUrl: profile.baseUrl,
      modelId: profile.modelId,
      capabilities: profile.capabilities,
      contextWindow: profile.contextWindow,
      maxOutputTokens: profile.maxOutputTokens,
      timeoutMs: profile.timeoutMs,
    });
    let committed = false;
    return {
      profile,
      apiKey: resolved.apiKey,
      snapshot,
      messages,
      tools,
      commit: () =>
        this.store.transaction(() => {
          validate();
          if (committed) throw new AppError('INVALID_INPUT', '启动请求已经提交');
          const run = this.store.runs.createWithUserMessage(n, session.id, request.text, {
            snapshot,
            attachmentIds: request.attachmentIds,
          });
          committed = true;
          return run;
        }),
    };
  }
}
