/** Implements an Electron main-process service or integration boundary. */
/* 中文：实现 Electron 主进程服务及其与其他模块的集成接口。 */
import {
  asAppError,
  workerReplySchema,
  type AgentEvent,
  type RunInput,
  type ToolCall,
  type ToolResult,
  type WorkerCommand,
} from '../../../../packages/shared/src/index';
import type { Supervisor } from './agent-service';
/** Specifies the contract callers must satisfy at this module boundary. */
/* 中文：定义调用方在模块边界需要遵守的接口契约。 */
export interface WorkerChild {
  postMessage(message: WorkerCommand): void;
  on(event: 'message', listener: (message: unknown) => void): unknown;
  on(event: 'exit', listener: (code: number) => void): unknown;
  kill(): boolean;
}
/** Defines the data shape exchanged through this module without exposing its implementation. */
/* 中文：定义模块间传递的数据结构，隐藏内部实现细节。 */
type State = {
  child: WorkerChild;
  queue: Promise<void>;
  terminal: boolean;
  timer?: ReturnType<typeof setTimeout>;
  ended: Promise<void>;
};
/** Owns the module boundary represented by worker Supervisor and coordinates its collaborators. */
/* 中文：启动、监控和停止隔离的智能体工作进程。 */
export class WorkerSupervisor implements Supervisor {
  private children = new Map<string, State>();
  constructor(private factory: () => WorkerChild) {}
  /** Initializes the module operation and connects it to its required lifecycle dependencies. */
  /* 中文：初始化模块操作，并连接执行所需的生命周期依赖。 */
  start(
    input: RunInput,
    apiKey: string,
    onEvent: (event: AgentEvent) => Promise<void>,
    onTool: (call: ToolCall) => Promise<ToolResult>,
    onExit: () => Promise<void>,
  ) {
    const child = this.factory();
    let ended!: () => void,
      started = false;
    /** Captures domain configuration or protocol data whose fields are consumed together by this module. */
    /* 中文：组织本模块需要共同使用的业务配置或协议数据。 */
    const state: State = {
        child,
        queue: Promise.resolve(),
        terminal: false,
        ended: new Promise((resolve) => {
          ended = resolve;
        }),
      },
      seen = new Set<string>();
    this.children.set(input.runId, state);
    /** Implements one focused part of this module’s public responsibility. */
    /* 中文：实现本模块职责中的一项具体操作。 */
    const post = (message: WorkerCommand) => {
      if (this.children.get(input.runId) === state) child.postMessage(message);
    };
    child.on('message', (raw) => {
      const parsed = workerReplySchema.safeParse(raw);
      if (!parsed.success || (parsed.data.type !== 'ready' && parsed.data.runId !== input.runId)) {
        child.kill();
        return;
      }
      const message = parsed.data;
      if (message.type === 'ready') {
        if (started) {
          child.kill();
          return;
        }
        started = true;
        post({ type: 'start', input, apiKey });
        apiKey = '';
        return;
      }
      if (seen.has(message.requestId) || seen.size >= 20000) {
        child.kill();
        return;
      }
      seen.add(message.requestId);
      state.queue = state.queue
        .then(async () => {
          if (message.type === 'event') {
            try {
              await onEvent(message.event);
              post({
                type: 'event_ack',
                runId: input.runId,
                requestId: message.requestId,
              });
              if (
                message.event.type === 'status' &&
                ['completed', 'cancelled', 'failed', 'interrupted'].includes(message.event.status)
              ) {
                state.terminal = true;
                post({ type: 'shutdown' });
                state.timer ??= setTimeout(() => child.kill(), 2000);
              }
            } catch (error) {
              const safe = asAppError(error);
              post({
                type: 'event_ack',
                runId: input.runId,
                requestId: message.requestId,
                error: { code: safe.code, message: safe.safeMessage },
              });
              child.kill();
            }
          } else {
            let result: ToolResult;
            try {
              result = await onTool(message.call);
            } catch (error) {
              const safe = asAppError(error);
              result = {
                content: `${safe.code}: ${safe.safeMessage}`,
                isError: true,
              };
            }
            post({
              type: 'tool_result',
              runId: input.runId,
              requestId: message.requestId,
              result,
            });
          }
        })
        .catch(() => {
          child.kill();
        });
    });
    child.on('exit', () => {
      clearTimeout(state.timer);
      this.children.delete(input.runId);
      void state.queue
        .then(onExit)
        .catch(() => {})
        .finally(ended);
    });
  }
  /** Releases managed state and prevents further use of the affected resource. */
  cancel(runId: string) {
    const state = this.children.get(runId);
    if (!state) return;
    state.child.postMessage({ type: 'cancel', runId });
    state.timer ??= setTimeout(() => state.child.kill(), 2000);
  }
  /** Releases managed state and prevents further use of the affected resource. */
  async shutdown() {
    const states = [...this.children.entries()];
    for (const [id] of states) this.cancel(id);
    await Promise.all(states.map(([, s]) => s.ended));
  }
}
