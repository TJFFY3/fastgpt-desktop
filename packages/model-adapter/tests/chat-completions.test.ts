import { afterEach, expect, it } from "vitest";
import { OpenAiChatAdapter, normalizeChatEndpoint } from "../src/index";
import {
  chatChunk,
  startModelServer,
  writeStream,
} from "../../../tests/fixtures/openai-server";
import { fakeModelProfile } from "../../../tests/fixtures/data";
import type { ModelEvent } from "../../shared/src/types";
const servers: Awaited<ReturnType<typeof startModelServer>>[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((s) => s.close()));
});
async function serve(fn: Parameters<typeof startModelServer>[0]) {
  const s = await startModelServer(fn);
  servers.push(s);
  return s;
}
async function collect(
  s: Awaited<ReturnType<typeof serve>>,
  patch = {},
  signal = new AbortController().signal,
) {
  const events: ModelEvent[] = [];
  for await (const e of new OpenAiChatAdapter().stream({
    profile: {
      ...fakeModelProfile,
      allowInsecureHttp: true,
      baseUrl: s.baseUrl,
      ...patch,
    },
    apiKey: "test-secret",
    messages: [{ role: "user", content: "hello" }],
    tools: [],
    signal,
  }))
    events.push(e);
  return events;
}
it("normalizes API roots without inventing v1 and rejects unsupported URLs", () => {
  expect(normalizeChatEndpoint("https://example.com/api/").href).toBe(
    "https://example.com/api/chat/completions",
  );
  expect(
    normalizeChatEndpoint("https://example.com/v1/chat/completions").href,
  ).toBe("https://example.com/v1/chat/completions");
  for (const url of [
    "file:///x",
    "https://u:p@example.com",
    "https://example.com?q=x",
    "https://example.com#x",
  ])
    expect(() => normalizeChatEndpoint(url)).toThrow(/INVALID_INPUT/);
});
it("preserves text and interleaved tool deltas while omitting unsupported parameters", async () => {
  const s = await serve((_b, res) =>
    writeStream(res, [
      chatChunk({ content: "你好，世界" }),
      chatChunk({
        tool_calls: [
          {
            index: 0,
            id: "a",
            function: { name: "time", arguments: '{"zone":' },
          },
          { index: 1, id: "b", function: { name: "other", arguments: "{}" } },
        ],
      }),
      chatChunk({
        tool_calls: [{ index: 0, function: { arguments: '"Asia/Shanghai"}' } }],
      }),
      chatChunk({}, "tool_calls"),
    ]),
  );
  const events = await collect(s, {
    capabilities: {
      tools: true,
      temperature: false,
      outputTokenField: "max_completion_tokens",
    },
  });
  expect(
    events
      .filter((e) => e.type === "text_delta")
      .map((e) => e.text)
      .join(""),
  ).toBe("你好，世界");
  expect(
    events
      .flatMap((e) =>
        e.type === "tool_call_delta" && e.index === 0
          ? [e.argumentsDelta || ""]
          : [],
      )
      .join(""),
  ).toBe('{"zone":"Asia/Shanghai"}');
  expect(s.requests[0]).not.toHaveProperty("temperature");
  expect(s.requests[0].max_completion_tokens).toBe(4096);
});
it("reads a non-streaming-compatible response and omits tools for unsupported models", async () => {
  const s = await serve((_b, res) => {
    res.setHeader("Content-Type", "application/json");
    res.end(
      JSON.stringify({
        choices: [
          {
            message: { role: "assistant", content: "fallback" },
            finish_reason: "stop",
          },
        ],
      }),
    );
  });
  const events = await collect(s, {
    capabilities: {
      tools: false,
      temperature: false,
      outputTokenField: "max_tokens",
    },
  });
  expect(events).toContainEqual({ type: "text_delta", text: "fallback" });
  expect(s.requests[0]).not.toHaveProperty("tools");
});
it("redacts authentication errors without retrying", async () => {
  const s = await serve((_b, res) => {
    res.writeHead(401);
    res.end("test-secret echoed by provider");
  });
  try {
    await collect(s);
    throw new Error("expected failure");
  } catch (e) {
    expect(String(e)).toContain("AUTH_FAILED");
    expect(String(e)).not.toContain("test-secret");
  }
  expect(s.requests).toHaveLength(1);
});
it("retries throttling only before output, and eventually returns text", async () => {
  let n = 0;
  const s = await serve((_b, res) => {
    if (++n < 3) {
      res.writeHead(429, { "Retry-After": "0" });
      res.end("limited");
    } else
      writeStream(res, [chatChunk({ content: "ok" }), chatChunk({}, "stop")]);
  });
  const events = await collect(s);
  expect(events).toContainEqual({ type: "text_delta", text: "ok" });
  expect(s.requests).toHaveLength(3);
});
it("rejects incomplete EOF and malformed JSON without repeating the request", async () => {
  const s = await serve((_b, res) => {
    res.writeHead(200, { "Content-Type": "text/event-stream" });
    res.end(`data: ${JSON.stringify(chatChunk({ content: "partial" }))}\n\n`);
  });
  await expect(collect(s)).rejects.toThrow(/MODEL_PROTOCOL_ERROR/);
  expect(s.requests).toHaveLength(1);
  const malformed = await serve((_b, res) => {
    res.writeHead(200, { "Content-Type": "text/event-stream" });
    res.end("data: not-json\n\n");
  });
  await expect(collect(malformed)).rejects.toThrow(/MODEL_PROTOCOL_ERROR/);
});
it("distinguishes timeout from user cancellation", async () => {
  const s = await serve(() => {});
  await expect(collect(s, { timeoutMs: 30 })).rejects.toThrow(/TIMEOUT/);
  const controller = new AbortController();
  const pending = collect(s, {}, controller.signal);
  setTimeout(() => controller.abort(), 20);
  await expect(pending).rejects.toThrow(/ABORTED/);
});
it("requires explicit opt-in for cleartext HTTP", async () => {
  const s = await serve((_b, res) => writeStream(res, [chatChunk({}, "stop")]));
  await expect(collect(s, { allowInsecureHttp: false })).rejects.toThrow(
    /INVALID_INPUT/,
  );
  expect(s.requests).toHaveLength(0);
});
it("cancels a 503 retry delay and never sends another request", async () => {
  const controller = new AbortController();
  const s = await serve((_b, res) => {
    res.writeHead(503, { "Retry-After": "5" });
    res.end();
    setTimeout(() => controller.abort(), 20);
  });
  await expect(collect(s, {}, controller.signal)).rejects.toThrow(/ABORTED/);
  expect(s.requests).toHaveLength(1);
});
it("probes tools without executing them and distinguishes text-only support", async () => {
  const s = await serve((body, res) => {
    res.setHeader("Content-Type", "application/json");
    res.end(
      JSON.stringify({
        choices: [
          {
            message: body.tools
              ? {
                  tool_calls: [
                    {
                      id: "probe",
                      function: { name: "connection_probe", arguments: "{}" },
                    },
                  ],
                }
              : { content: "OK" },
            finish_reason: body.tools ? "tool_calls" : "stop",
          },
        ],
      }),
    );
  });
  expect(
    await new OpenAiChatAdapter().probe({
      profile: {
        ...fakeModelProfile,
        baseUrl: s.baseUrl,
        allowInsecureHttp: true,
      },
      apiKey: "test",
      signal: new AbortController().signal,
    }),
  ).toEqual({ reachable: true, tools: true });
  expect(s.requests).toHaveLength(2);
});
