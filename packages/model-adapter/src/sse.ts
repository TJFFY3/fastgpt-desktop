import { AppError, throwIfAborted } from "../../shared/src/index";
export async function* parseSse(
  body: ReadableStream<Uint8Array>,
  signal: AbortSignal,
): AsyncGenerator<{ event: string; data: string }> {
  throwIfAborted(signal);
  const reader = body.getReader(),
    decoder = new TextDecoder();
  let buffer = "",
    event = "message",
    lines: string[] = [],
    size = 0;
  const cancel = () => {
    void reader.cancel().catch(() => {});
  };
  signal.addEventListener("abort", cancel, { once: true });
  try {
    while (true) {
      throwIfAborted(signal);
      const { done, value } = await reader.read();
      throwIfAborted(signal);
      buffer += done
        ? decoder.decode()
        : decoder.decode(value, { stream: true });
      if (buffer.length + size > 2 * 1024 * 1024)
        throw new AppError("MODEL_PROTOCOL_ERROR", "模型返回的数据帧过大");
      let match: RegExpExecArray | null;
      while ((match = /\r\n|\n|\r/.exec(buffer))) {
        if (!done && match[0] === "\r" && match.index === buffer.length - 1)
          break;
        const line = buffer.slice(0, match.index);
        buffer = buffer.slice(match.index + match[0].length);
        if (!line) {
          if (lines.length) yield { event, data: lines.join("\n") };
          event = "message";
          lines = [];
          size = 0;
          continue;
        }
        if (line.startsWith(":")) continue;
        const colon = line.indexOf(":"),
          field = colon < 0 ? line : line.slice(0, colon),
          raw = colon < 0 ? "" : line.slice(colon + 1),
          text = raw.startsWith(" ") ? raw.slice(1) : raw;
        if (field === "data") {
          lines.push(text);
          size += text.length;
        } else if (field === "event") event = text;
      }
      if (done) break; // An incomplete final frame is never dispatched.
    }
  } finally {
    signal.removeEventListener("abort", cancel);
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
