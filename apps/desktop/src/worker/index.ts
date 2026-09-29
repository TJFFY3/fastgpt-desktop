/** Provides the index module for the desktop application. */
import type {} from 'electron';
import { randomUUID } from 'node:crypto';
import { AgentRunner } from '../../../../packages/agent-core/src/index';
import { OpenAiChatAdapter } from '../../../../packages/model-adapter/src/index';
import {
  AppError,
  workerCommandSchema,
  type ToolResult,
  type WorkerReply,
} from '../../../../packages/shared/src/index';
const port = process.parentPort;
if (!port) throw new Error('The agent worker requires a parent process.');
const pending = new Map<
  string,
  {
    kind: 'event' | 'tool';
    resolve(result?: ToolResult): void;
    reject(error: AppError): void;
    timer: ReturnType<typeof setTimeout>;
  }
>();
const controller = new AbortController();
let runId: string | undefined,
  started = false;
/** Performs request for this module. */
function request(message: WorkerReply & { requestId: string }): Promise<ToolResult | undefined> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(message.requestId);
      reject(new AppError('WORKER_PARENT_TIMEOUT', '主进程未响应'));
    }, 30000);
    pending.set(message.requestId, {
      kind: message.type === 'tool_request' ? 'tool' : 'event',
      resolve,
      reject,
      timer,
    });
    port.postMessage(message);
  });
}
port.on('message', async ({ data }: { data: unknown }) => {
  const parsed = workerCommandSchema.safeParse(data);
  if (!parsed.success) {
    process.exit(1);
    return;
  }
  const command = parsed.data;
  if (command.type === 'shutdown') {
    process.exit(0);
    return;
  }
  if (command.type === 'start') {
    if (started) {
      process.exit(1);
      return;
    }
    started = true;
    runId = command.input.runId;
    const runner = new AgentRunner({
      model: new OpenAiChatAdapter(),
      onEvent: async (event) => {
        await request({
          type: 'event',
          runId: runId!,
          requestId: randomUUID(),
          event,
        });
      },
      executor: {
        execute: async (call) =>
          (await request({
            type: 'tool_request',
            runId: runId!,
            requestId: randomUUID(),
            call,
          }))!,
      },
    });
    try {
      await runner.run(command.input, command.apiKey, controller.signal);
    } catch {
      process.exit(1);
    } finally {
      command.apiKey = '';
    }
    return;
  }
  if (command.runId !== runId) {
    process.exit(1);
    return;
  }
  if (command.type === 'cancel') {
    controller.abort();
    for (const [id, p] of pending)
      if (p.kind === 'tool') {
        clearTimeout(p.timer);
        p.reject(new AppError('ABORTED', '任务已取消'));
        pending.delete(id);
      }
    return;
  }
  const p = pending.get(command.requestId);
  if (!p) return;
  if ((command.type === 'tool_result') !== (p.kind === 'tool')) {
    process.exit(1);
    return;
  }
  clearTimeout(p.timer);
  pending.delete(command.requestId);
  if (command.type === 'event_ack' && command.error)
    p.reject(new AppError(command.error.code, command.error.message));
  else p.resolve(command.type === 'tool_result' ? command.result : undefined);
});
port.postMessage({ type: 'ready' });
