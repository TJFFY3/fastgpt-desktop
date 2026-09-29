/** Provides the agent service module for the desktop application. */
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
/** Describes the supervisor contract used by this module. */
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
/** Coordinates agent Service responsibilities for this module. */
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
  /** Handles start within this module's workflow. */
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
    /** Configures state, the module data used by this workflow. */
    const run = prepared.commit(),
      state = {
        namespace: n,
        controller: new AbortController(),
        partial: '',
        error: null as string | null,
      };
    this.running.set(run.id, state);
    this.clock.start(run.id);
    /** Performs event for this module. */
    const event = async (value: AgentEvent) => {
      const persisted = this.store.transaction(() => {
        let messageId: string | undefined;
        const current = this.store.runs.get(n, run.id);
        if (!activeStatuses.includes(current.status)) return;
        // A cancelled worker may finish a pending round; it cannot commit a new successful response.
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
    /** Performs on Exit for this module. */
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
    /** Performs throw If Active for this module. */
    function throwIfActive() {
      if (state.controller.signal.aborted) throw new AppError('ABORTED', '任务已取消');
    }
    return this.store.runs.get(n, run.id);
  }
  /** Handles cancel within this module's workflow. */
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
  /** Handles cancel Namespace within this module's workflow. */
  async cancelNamespace(n: Namespace) {
    this.revoked.add(namespaceKey(n));
    await Promise.all(
      [...this.running.entries()]
        .filter(([, s]) => namespaceKey(s.namespace) === namespaceKey(n))
        .map(([id]) => this.cancel(n, id)),
    );
  }
  /** Handles timing within this module's workflow. */
  timing(n: Namespace, runId: string): RunTimingSnapshot {
    const run = this.store.runs.get(n, runId),
      active = activeStatuses.includes(run.status);
    return {
      runId,
      active,
      elapsedMs: active && this.running.has(runId) ? this.clock.elapsed(runId) : run.elapsedMs,
    };
  }
  /** Handles dispose within this module's workflow. */
  dispose(): void {
    this.clock.dispose();
  }
}
