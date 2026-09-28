import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
type Body = { messages?: { role: string; content: string | null }[]; tools?: { function: { name: string } }[]; stream?: boolean; [key: string]: unknown };
export async function startModelServer(handler: (body: Body, res: ServerResponse, req: IncomingMessage) => void) {
  const requests: Body[] = [];
  const server = createServer(async (req, res) => {
    let text = ''; for await (const chunk of req) text += chunk.toString();
    const body = JSON.parse(text || '{}') as Body; requests.push(body); handler(body, res, req);
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  return { baseUrl: `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`, requests,
    close: () => new Promise<void>((resolve, reject) => { server.close(error => error ? reject(error) : resolve()); server.closeAllConnections(); }) };
}
export function writeStream(res: ServerResponse, chunks: unknown[]) {
  res.writeHead(200, { 'Content-Type': 'text/event-stream' });
  for (const chunk of chunks) res.write(`data: ${JSON.stringify(chunk)}\n\n`);
  res.end('data: [DONE]\n\n');
}
export const chatChunk = (delta: Record<string, unknown>, finish: string | null = null) => ({ id: 'completion-test', object: 'chat.completion.chunk', created: 1, model: 'test', choices: [{ index: 0, delta, finish_reason: finish }] });
export async function startFixtureModelServer() {
  return startModelServer((body, res) => {
    if (!body.stream) {
      const tool = body.tools?.[0]?.function.name;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ choices: [{ message: { role: 'assistant', content: tool ? null : '连接成功', ...(tool ? { tool_calls: [{ id: 'probe-1', type: 'function', function: { name: tool, arguments: '{}' } }] } : {}) }, finish_reason: tool ? 'tool_calls' : 'stop' }] })); return;
    }
    const last = body.messages?.at(-1);
    if (last?.role === 'user' && last.content?.includes('慢')) {
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      res.write(`data: ${JSON.stringify(chatChunk({ content: '正在生成' }))}\n\n`);
      const timer = setTimeout(() => { writeStream(res, [chatChunk({ content: '完成' }), chatChunk({}, 'stop')]); }, 10000);
      res.on('close', () => clearTimeout(timer)); return;
    }
    if (last?.role === 'user' && last.content?.includes('时间') && body.tools?.length) {
      writeStream(res, [chatChunk({ tool_calls: [{ index: 0, id: 'call-fixture-1', type: 'function', function: { name: 'get_current_time', arguments: '{"time' } }] }), chatChunk({ tool_calls: [{ index: 0, function: { arguments: 'zone":"Asia/Shanghai"}' } }] }), chatChunk({}, 'tool_calls')]); return;
    }
    writeStream(res, [chatChunk({ content: last?.role === 'tool' ? '工具执行成功，' : '你好，' }), chatChunk({ content: '这是测试回复。' }), chatChunk({}, 'stop')]);
  });
}
