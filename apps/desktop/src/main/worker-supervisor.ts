/** Provides the worker supervisor module for the desktop application. */
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
/** Describes the worker Child contract used by this module. */
export interface WorkerChild {
  postMessage(message: WorkerCommand): void;
  on(event: 'message', listener: (message: unknown) => void): unknown;
  on(event: 'exit', listener: (code: number) => void): unknown;
  kill(): boolean;
}
/** Defines the state data shape used by this module. */
type State = {
  child: WorkerChild;
  queue: Promise<void>;
  terminal: boolean;
  timer?: ReturnType<typeof setTimeout>;
  ended: Promise<void>;
};
/** Coordinates worker Supervisor responsibilities for this module. */
export class WorkerSupervisor implements Supervisor {
  private children = new Map<string, State>();
  constructor(private factory: () => WorkerChild) {}
  /** Handles start within this module's workflow. */
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
    /** Configures state, the module data used by this workflow. */
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
    /** Performs post for this module. */
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
  /** Handles cancel within this module's workflow. */
  cancel(runId: string) {
    const state = this.children.get(runId);
    if (!state) return;
    state.child.postMessage({ type: 'cancel', runId });
    state.timer ??= setTimeout(() => state.child.kill(), 2000);
  }
  /** Handles shutdown within this module's workflow. */
  async shutdown() {
    const states = [...this.children.entries()];
    for (const [id] of states) this.cancel(id);
    await Promise.all(states.map(([, s]) => s.ended));
  }
}
