/** Provides the run start service module for the desktop application. */
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
export function modelHistory(records: MessageRecord[]): ChatMessage[] {
  const result: ChatMessage[] = [];
  for (let i = 0; i < records.length; i++) {
    const r = records[i];
    if (r.status !== 'complete' || r.role === 'tool') continue;
    /** Configures message, the module data used by this workflow. */
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
/** Defines the context Preparer data shape used by this module. */
export type ContextPreparer = (
  n: Namespace,
  request: RunStartRequest,
  profile: ModelProfile,
  tools: ToolSpec[],
) => Promise<ChatMessage[]>;
/** Coordinates run Start Service responsibilities for this module. */
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
  /** Handles prepare within this module's workflow. */
  async prepare(n: Namespace, input: RunStartRequest) {
    const request = runStartSchema.parse(input),
      key = namespaceKey(n);
    /** Performs identity for this module. */
    const identity = () => {
      if (namespaceKey(this.principal()) !== key)
        throw new AppError('PERMISSION_DENIED', '当前身份已失效');
    };
    identity();
    const session = this.store.sessions.get(n, request.sessionId),
      profile = this.store.providers.get(n, session.providerId),
      workspace = this.store.workspaces.getForSession(n, session.id);
    /** Performs validate for this module. */
    const validate = () => {
      identity();
      const current = this.store.sessions.get(n, session.id),
        model = this.store.providers.get(n, session.providerId),
        ws = this.store.workspaces.getForSession(n, session.id);
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
    const messages = await this.prepareContext(n, request, profile, tools);
    validate();
    const snapshot = modelSnapshotSchema.parse({
      providerId: profile.id,
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
