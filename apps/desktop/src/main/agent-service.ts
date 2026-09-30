/** Implements an Electron main-process service or integration boundary. */
/* 中文：实现 Electron 主进程服务及其与其他模块的集成接口。 */
import {
  AppError,
  runStartSchema,
  type AgentEvent,
  type RunStartOptions,
  type RunTimingSnapshot,
  type Namespace,
  type RunEvent,
  type RunInput,
  type ToolCall,
  type ToolResult,
} from '../../../../packages/shared/src/index';
import { activeStatuses, namespaceKey, type Store } from '../../../../packages/storage/src/index';
import type { ToolRegistry } from '../../../../packages/agent-core/src/index';
import type { ProviderService } from './provider-service';
import { ToolGateway } from './tool-gateway';
import { RunClock } from './run-clock';
import { RunStartService, type ContextPreparer } from './run-start-service';
export { modelHistory } from './run-start-service';
/** Specifies the contract callers must satisfy at this module boundary. */
/* 中文：定义调用方在模块边界需要遵守的接口契约。 */
export interface Supervisor {
  start(
    input: RunInput,
    apiKey: string,
    onEvent: (event: AgentEvent) => Promise<void>,
    onTool: (call: ToolCall) => Promise<ToolResult>,
    onExit: () => Promise<void>,
  ): void;
  cancel(runId: string): void;
  shutdown(): Promise<void>;
}
/** Owns the module boundary represented by agent Service and coordinates its collaborators. */
/* 中文：协调任务启动、运行事件、取消操作和结果持久化。 */
export class AgentService {
  private running = new Map<
    string,
    {
      namespace: Namespace;
      controller: AbortController;
      partial: string;
      error: string | null;
    }
  >();
  private revoked = new Set<string>();
  private gateway: ToolGateway;
  private clock: RunClock;
  private starts: RunStartService;
  constructor(
    private store: Store,
    private providers: ProviderService,
    private supervisor: Supervisor,
    private tools: ToolRegistry,
    private principal: () => Namespace,
    private publish: (event: RunEvent) => void,
    prepareContext?: ContextPreparer,
  ) {
    this.gateway = new ToolGateway(store.runs, tools);
    this.starts = new RunStartService(
      store,
      providers,
      principal,
      () => tools.definitions(),
      prepareContext,
    );
    this.clock = new RunClock(
      (id, elapsed) => {
        const state = this.running.get(id);
        if (state) store.runs.saveTiming(state.namespace, id, elapsed);
      },
      () => performance.now(),
      (id) => {
        const state = this.running.get(id);
        state?.controller.abort();
        supervisor.cancel(id);
      },
    );
  }
  /** Initializes the module operation and connects it to its required lifecycle dependencies. */
  /* 中文：初始化模块操作，并连接执行所需的生命周期依赖。 */
  async start(n: Namespace, sessionId: string, text: string, options?: RunStartOptions) {
    const request = runStartSchema.parse({
      sessionId,
      text,
      ...(options ?? { attachmentIds: [] }),
    });
    if (this.revoked.has(namespaceKey(n)) || namespaceKey(n) !== namespaceKey(this.principal()))
      throw new AppError('PERMISSION_DENIED', '当前身份已失效');
    const prepared = await this.starts.prepare(n, request);
    if (this.revoked.has(namespaceKey(n)) || namespaceKey(n) !== namespaceKey(this.principal()))
      throw new AppError('PERMISSION_DENIED', '当前身份已失效');
    /** Captures domain configuration or protocol data whose fields are consumed together by this module. */
    /* 中文：组织本模块需要共同使用的业务配置或协议数据。 */
    const run = prepared.commit(),
      state = {
        namespace: n,
        controller: new AbortController(),
        partial: '',
        error: null as string | null,
      };
    this.running.set(run.id, state);
    this.clock.start(run.id);
    /** Implements one focused part of this module’s public responsibility. */
    /* 中文：实现本模块职责中的一项具体操作。 */
    const event = async (value: AgentEvent) => {
      const persisted = this.store.transaction(() => {
        let messageId: string | undefined;
        const current = this.store.runs.get(n, run.id);
        if (!activeStatuses.includes(current.status)) return;
        // A cancelled worker may finish a pending round; it cannot commit a new successful response.
        // 已取消的工作进程可能完成当前轮次，但不得再提交新的成功响应。
        if (state.controller.signal.aborted && value.type !== 'status' && value.type !== 'error')
          return;
        if (value.type === 'status') {
          const status =
            state.controller.signal.aborted && value.status === 'completed'
              ? 'cancelled'
              : value.status;
          if (activeStatuses.includes(status)) this.clock.checkpoint(run.id);
          else this.clock.finish(run.id);
          if (status !== current.status) this.store.runs.transition(n, run.id, status, state.error);
          value = { ...value, status };
          if (!activeStatuses.includes(status)) {
            if (state.partial)
              this.store.sessions.appendMessage(
                n,
                sessionId,
                { role: 'assistant', content: state.partial },
                status === 'interrupted' ? 'interrupted' : 'partial',
                { runId: run.id },
              );
            state.partial = '';
            this.running.delete(run.id);
          }
        } else if (value.type === 'text_delta') state.partial += value.text;
        else if (value.type === 'assistant_message') {
          const message = this.store.sessions.appendMessage(
            n,
            sessionId,
            value.message,
            'complete',
            { runId: run.id },
          );
          messageId = message.id;
          if (value.message.role === 'assistant') state.partial = '';
        } else if (value.type === 'error') state.error = value.code;
        return this.store.runs.appendEvent(n, run.id, value, messageId ? { messageId } : undefined);
      });
      if (
        persisted &&
        !this.revoked.has(namespaceKey(n)) &&
        namespaceKey(this.principal()) === namespaceKey(n)
      )
        this.publish(persisted);
    };
    /** Implements one focused part of this module’s public responsibility. */
    /* 中文：实现本模块职责中的一项具体操作。 */
    const onExit = async () => {
      const current = this.store.runs.get(n, run.id);
      if (activeStatuses.includes(current.status)) {
        state.error = 'WORKER_EXITED';
        await event({
          type: 'status',
          status: state.controller.signal.aborted ? 'cancelled' : 'interrupted',
        });
      }
    };
    try {
      this.supervisor.start(
        {
          runId: run.id,
          sessionId,
          namespace: n,
          profile: prepared.profile,
          messages: prepared.messages,
          tools: prepared.tools,
        },
        prepared.apiKey,
        event,
        async (call) => {
          throwIfActive();
          return this.gateway.execute(
            call,
            { namespace: n, runId: run.id, sessionId },
            state.controller.signal,
          );
        },
        onExit,
      );
    } catch {
      state.error = 'WORKER_START_FAILED';
      await event({ type: 'status', status: 'failed' });
    }
    /** Implements one focused part of this module’s public responsibility. */
    /* 中文：实现本模块职责中的一项具体操作。 */
    function throwIfActive() {
      if (state.controller.signal.aborted) throw new AppError('ABORTED', '任务已取消');
    }
    return this.store.runs.get(n, run.id);
  }
  /** Releases managed state and prevents further use of the affected resource. */
  /* 中文：释放受管理的状态，并阻止继续使用已失效的资源。 */
  async cancel(n: Namespace, runId: string) {
    const run = this.store.runs.get(n, runId);
    if (!activeStatuses.includes(run.status)) return;
    const state = this.running.get(runId);
    state?.controller.abort();
    this.clock.checkpoint(runId);
    if (run.status !== 'cancelling') {
      this.store.runs.transition(n, runId, 'cancelling');
      const e = this.store.runs.appendEvent(n, runId, {
        type: 'status',
        status: 'cancelling',
      });
      if (namespaceKey(n) === namespaceKey(this.principal())) this.publish(e);
    }
    this.supervisor.cancel(runId);
  }
  /** Releases managed state and prevents further use of the affected resource. */
  /* 中文：释放受管理的状态，并阻止继续使用已失效的资源。 */
  async cancelNamespace(n: Namespace) {
    this.revoked.add(namespaceKey(n));
    await Promise.all(
      [...this.running.entries()]
        .filter(([, s]) => namespaceKey(s.namespace) === namespaceKey(n))
        .map(([id]) => this.cancel(n, id)),
    );
  }
  /** Implements one focused part of this module’s public responsibility. */
  /* 中文：实现本模块职责中的一项具体操作。 */
  timing(n: Namespace, runId: string): RunTimingSnapshot {
    const run = this.store.runs.get(n, runId),
      active = activeStatuses.includes(run.status);
    return {
      runId,
      active,
      elapsedMs: active && this.running.has(runId) ? this.clock.elapsed(runId) : run.elapsedMs,
    };
  }
  /** Implements one focused part of this module’s public responsibility. */
  /* 中文：实现本模块职责中的一项具体操作。 */
  dispose(): void {
    this.clock.dispose();
  }
}
