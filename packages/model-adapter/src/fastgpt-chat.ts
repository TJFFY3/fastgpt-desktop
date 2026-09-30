/** Runs remote FastGPT applications without substituting a local model. */
/* 中文：通过固定应用与会话标识调用 FastGPT，转换流式事件并保持运行状态真实。 */
import { AppError, throwIfAborted, type AgentEvent, type RunInput } from '../../shared/src/index';
import { parseSse } from './sse';
export class FastGptChat {
  constructor(private request: typeof fetch = fetch) {}
  /* 中文：执行一次远程应用对话，由云端决定模型和工作流。 */
  async run(
    input: RunInput,
    key: string,
    signal: AbortSignal,
    emit: (event: AgentEvent) => Promise<void>,
  ): Promise<void> {
    const timed = AbortSignal.any([signal, AbortSignal.timeout(input.profile.timeoutMs)]);
    let text = '';
    try {
      throwIfAborted(signal);
      const appId = input.profile.fastgpt?.appId;
      if (!appId || input.profile.capabilities.tools || input.tools.length)
        throw new AppError('INVALID_INPUT', '远程应用目标配置无效');
      const user = input.messages.at(-1);
      if (user?.role !== 'user' || !user.content)
        throw new AppError('INVALID_INPUT', '远程对话需要文本消息');
      const endpoint = new URL(input.profile.baseUrl.replace(/\/+$/, '') + '/chat/completions');
      if (
        endpoint.protocol !== 'https:' ||
        endpoint.username ||
        endpoint.password ||
        endpoint.search ||
        endpoint.hash
      )
        throw new AppError('INVALID_INPUT', '远程应用必须使用 HTTPS API 地址');
      await emit({ type: 'status', status: 'running' });
      const response = await this.request(endpoint.toString(), {
        method: 'POST',
        redirect: 'error',
        signal: timed,
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          appId,
          chatId: `desktop-${input.sessionId}`,
          messages: [{ role: 'user', content: user.content }],
          stream: true,
          variables: {},
          responseChatItemId: input.runId,
          // 中文：保留交互事件以识别尚待用户输入的工作流；其余元数据不会展示或持久化。
          detail: true,
          retainDatasetCite: false,
          showSkillReferences: false,
        }),
      });
      if (!response.ok)
        throw new AppError(
          'FASTGPT_REQUEST',
          response.status === 401 || response.status === 403
            ? 'FastGPT 凭据无效或应用权限不足'
            : 'FastGPT 远程应用请求失败',
        );
      if (!response.body || !response.headers.get('content-type')?.includes('text/event-stream'))
        throw new AppError(
          'FASTGPT_REQUEST',
          'FastGPT 未返回对话事件流，请检查权限、余额和应用配置',
        );
      let done = false;
      for await (const frame of parseSse(response.body, timed)) {
        throwIfAborted(timed);
        if (frame.data.trim() === '[DONE]') {
          done = true;
          break;
        }
        if (frame.event === 'error')
          throw new AppError('FASTGPT_REQUEST', 'FastGPT 应用执行失败，请检查云端应用日志');
        if (frame.event === 'interactive')
          throw new AppError(
            'FASTGPT_INTERACTIVE_UNSUPPORTED',
            '此工作流需要表单或选项交互，桌面端暂不支持，请在 FastGPT 网页中继续',
          );
        if (frame.event !== 'answer' && frame.event !== 'message') continue;
        let data: any;
        try {
          data = JSON.parse(frame.data);
        } catch {
          throw new AppError('FASTGPT_RESPONSE', 'FastGPT 返回了无效的对话数据');
        }
        if (data.error || (data.code !== undefined && data.code !== 200))
          throw new AppError('FASTGPT_REQUEST', 'FastGPT 应用执行失败，请检查云端应用日志');
        const delta = data.choices?.[0]?.delta;
        if (!delta) continue;
        if (
          delta.interactive ||
          (Array.isArray(delta.content) && delta.content.some((part: any) => part?.interactive))
        )
          throw new AppError(
            'FASTGPT_INTERACTIVE_UNSUPPORTED',
            '此工作流需要交互输入，请在 FastGPT 网页中继续',
          );
        if (
          delta.content !== null &&
          delta.content !== undefined &&
          typeof delta.content !== 'string'
        )
          throw new AppError('FASTGPT_OUTPUT_UNSUPPORTED', '此应用返回了暂不支持的非文本内容');
        if (delta.content) {
          text += delta.content;
          if (Buffer.byteLength(text) > 1024 * 1024)
            throw new AppError('RUN_LIMIT', '远程应用回复超过长度限制');
          await emit({ type: 'text_delta', text: delta.content });
        }
      }
      throwIfAborted(timed);
      if (!done)
        throw new AppError(
          'FASTGPT_STREAM_INCOMPLETE',
          '远程连接提前结束，已保留收到的内容；未自动重试',
        );
      if (!text)
        throw new AppError('FASTGPT_OUTPUT_UNSUPPORTED', '远程应用没有返回可显示的文本回答');
      await emit({ type: 'assistant_message', message: { role: 'assistant', content: text } });
      await emit({ type: 'status', status: 'completed' });
    } catch (error) {
      if (!signal.aborted) {
        const safe =
          error instanceof AppError
            ? error
            : new AppError('FASTGPT_NETWORK', '远程应用连接失败或超时，请重试');
        await emit({ type: 'error', code: safe.code, message: safe.safeMessage });
      }
      await emit({ type: 'status', status: signal.aborted ? 'cancelled' : 'failed' });
    }
  }
}
