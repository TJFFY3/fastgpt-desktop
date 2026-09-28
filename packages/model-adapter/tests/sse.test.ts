import { expect, it } from 'vitest';
import { parseSse } from '../src/sse';
function body(parts: Uint8Array[]) { return new ReadableStream<Uint8Array>({ start(c) { parts.forEach(p => c.enqueue(p)); c.close(); } }); }
it('decodes UTF-8 across bytes and frames CRLF, comments and multiline data', async () => {
  const bytes = new TextEncoder().encode(': comment\r\nevent: message\r\ndata: 你好\r\ndata: world\r\n\r\ndata: [DONE]\n\n');
  const frames = []; for await (const f of parseSse(body([...bytes].map(b => new Uint8Array([b]))), new AbortController().signal)) frames.push(f);
  expect(frames).toEqual([{ event: 'message', data: '你好\nworld' }, { event: 'message', data: '[DONE]' }]);
});
it('does not dispatch an unfinished frame at EOF', async () => {
  const frames = []; for await (const f of parseSse(body([new TextEncoder().encode('data: unfinished')]), new AbortController().signal)) frames.push(f);
  expect(frames).toEqual([]);
});
it('honors abort before reading', async () => {
  const controller = new AbortController(); controller.abort();
  await expect((async () => { for await (const _ of parseSse(body([]), controller.signal)) {} })()).rejects.toThrow(/ABORTED/);
});
