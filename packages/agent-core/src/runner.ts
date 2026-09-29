/** Coordinates agent execution, tool registration, and policy enforcement. */
import {
  AppError,
  asAppError,
  throwIfAborted,
  type AgentEvent,
  type ChatMessage,
  type ModelAdapter,
  type RunInput,
  type ToolCall,
  type ToolExecutor,
} from '../../shared/src/index';
/** Owns the module boundary represented by agent Runner and coordinates its collaborators. */
export class AgentRunner {
  constructor(
    private dependencies: {
      model: ModelAdapter;
      executor: ToolExecutor;
      onEvent(event: AgentEvent): Promise<void>;
    },
  ) {}
  /** Initializes the module operation and connects it to its required lifecycle dependencies. */
  async run(input: RunInput, apiKey: string, signal: AbortSignal): Promise<void> {
    const { model, executor, onEvent } = this.dependencies,
      messages = [...input.messages];
    let executions = 0,
      reasoningBytes = 0,
      reasoningTruncated = false;
    try {
      throwIfAborted(signal);
      await onEvent({ type: 'status', status: 'running' });
      for (let round = 0; round < 12; round++) {
        throwIfAborted(signal);
        const calls = new Map<number, ToolCall>();
        let text = '',
          reason: string | undefined;
        const tools = input.profile.capabilities.tools ? input.tools : [];
        for await (const event of model.stream({
          profile: input.profile,
          apiKey,
          messages: [...messages],
          tools,
          signal,
        })) {
          throwIfAborted(signal);
          if (
            event.type === 'reasoning_delta' &&
            input.profile.capabilities.reasoningField === 'reasoning_content'
          ) {
            const bytes = Buffer.from(event.text),
              remaining = 1024 * 1024 - reasoningBytes;
            if (!reasoningTruncated) {
              let end = Math.min(remaining, bytes.length);
              // Do not decode a partial UTF-8 codepoint at the byte budget boundary.
              if (end < bytes.length) while (end > 0 && (bytes[end] & 0xc0) === 0x80) end--;
              if (end) {
                reasoningBytes += end;
                await onEvent({
                  type: 'reasoning_delta',
                  text: bytes.subarray(0, end).toString('utf8'),
                });
              }
              if (bytes.length > remaining) {
                reasoningTruncated = true;
                await onEvent({ type: 'reasoning_truncated', limitBytes: 1024 * 1024 });
              }
            }
          }
          if (event.type === 'text_delta') {
            text += event.text;
            if (Buffer.byteLength(text) > 1024 * 1024)
              throw new AppError('RUN_LIMIT', '单条模型回复超过长度限制');
            await onEvent(event);
          }
          if (event.type === 'finish') reason = event.reason;
          if (event.type === 'tool_call_delta') {
            if (event.index >= 24 || !Number.isInteger(event.index) || event.index < 0)
              throw new AppError('RUN_LIMIT', '工具调用数量超过限制');
            const call = calls.get(event.index) ?? {
              id: '',
              name: '',
              arguments: '',
            };
            if (event.id) {
              if (call.id && call.id !== event.id)
                throw new AppError('MODEL_PROTOCOL_ERROR', '工具调用编号不一致');
              call.id = event.id;
            }
            if (event.name) call.name += event.name;
            call.arguments += event.argumentsDelta ?? '';
            if (call.arguments.length > 1024 * 1024)
              throw new AppError('RUN_LIMIT', '工具参数超过长度限制');
            calls.set(event.index, call);
          }
        }
        throwIfAborted(signal);
        if (!reason || (calls.size && reason !== 'tool_calls'))
          throw new AppError('MODEL_PROTOCOL_ERROR', '模型工具调用没有完整结束');
        if (reason !== 'tool_calls') {
          if (reason !== 'stop')
            throw new AppError('MODEL_INCOMPLETE', '模型未完整结束回复，请调整输出上限或检查服务');
          await onEvent({
            type: 'assistant_message',
            message: { role: 'assistant', content: text },
          });
          await onEvent({ type: 'status', status: 'completed' });
          return;
        }
        const ordered = [...calls.entries()].sort(([a], [b]) => a - b).map(([, c]) => c);
        if (!ordered.length || new Set(ordered.map((c) => c.id)).size !== ordered.length)
          throw new AppError('MODEL_PROTOCOL_ERROR', '工具调用为空或编号重复');
        for (const call of ordered) {
          if (!call.id || !tools.some((t) => t.name === call.name))
            throw new AppError('MODEL_PROTOCOL_ERROR', '模型请求了未知或不完整的工具');
          try {
            const args = JSON.parse(call.arguments);
            if (!args || typeof args !== 'object' || Array.isArray(args)) throw Error();
          } catch {
            throw new AppError('MODEL_PROTOCOL_ERROR', '工具参数不是有效 JSON 对象');
          }
        }
        /** Captures domain configuration or protocol data whose fields are consumed together by this module. */
        const assistant: ChatMessage = {
          role: 'assistant',
          content: text || null,
          toolCalls: ordered,
        };
        messages.push(assistant);
        await onEvent({ type: 'assistant_message', message: assistant });
        for (const call of ordered) {
          throwIfAborted(signal);
          if (++executions > 24) throw new AppError('RUN_LIMIT', '已达到单次任务的工具调用上限');
          await onEvent({ type: 'tool_started', call });
          let result = await executor.execute(
            call,
            {
              namespace: input.namespace,
              sessionId: input.sessionId,
              runId: input.runId,
            },
            signal,
          );
          throwIfAborted(signal);
          if (Buffer.byteLength(result.content) > 1024 * 1024)
            result = {
              content: '工具结果超过 1 MiB 限制，已拒绝返回。',
              isError: true,
            };
          await onEvent({ type: 'tool_finished', id: call.id, result });
          /** Captures domain configuration or protocol data whose fields are consumed together by this module. */
          const message: ChatMessage = {
            role: 'tool',
            toolCallId: call.id,
            content: result.content,
          };
          messages.push(message);
          await onEvent({ type: 'assistant_message', message });
        }
      }
      throw new AppError('RUN_LIMIT', '已达到单次任务的模型轮数上限');
    } catch (error) {
      const safe = signal.aborted ? new AppError('ABORTED', '任务已取消') : asAppError(error);
      if (safe.code !== 'ABORTED')
        await onEvent({
          type: 'error',
          code: safe.code,
          message: safe.safeMessage,
        });
      await onEvent({
        type: 'status',
        status: safe.code === 'ABORTED' ? 'cancelled' : 'failed',
      });
    }
  }
}
