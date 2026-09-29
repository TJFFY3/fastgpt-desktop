import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";
import type {
  MessageRecord,
  RunEvent,
} from "../../../packages/shared/src/index";
import { ChatView } from "../src/renderer/components/ChatView";

const message = (
  role: "user" | "assistant",
  content: string,
  status: MessageRecord["status"] = "complete",
): MessageRecord => ({
  runId: null,
  attachmentIds: [],
  id: `message-${role}`,
  sessionId: "session-1",
  seq: role === "user" ? 1 : 2,
  role,
  content,
  status,
  createdAt: 1,
});

const render = (messages: MessageRecord[], events: RunEvent[] = []) =>
  renderToStaticMarkup(
    createElement(ChatView, {
      messages,
      events,
      hasSession: true,
      hasModels: true,
      onSettings() {},
    }),
  );

test("completed messages show their content without speaker labels or avatars", () => {
  const html = render([
    message("user", "用户发送的内容"),
    message("assistant", "模型回复的内容"),
  ]);
  expect(html).toContain("用户发送的内容");
  expect(html).toContain("模型回复的内容");
  expect(html).not.toContain("FastGPT Agent");
  expect(html).not.toContain(">你<");
  expect(html).not.toContain("message-avatar");
});

test("streaming replies retain the generation indicator without a speaker label", () => {
  const html = render([message("user", "开始回复")], [
    {
      type: "text_delta",
      text: "流式回复的内容",
      runId: "run-1",
      sessionId: "session-1",
      seq: 1,
      createdAt: 1,
    },
  ]);
  expect(html).toContain("流式回复的内容");
  expect(html).toContain("正在生成");
  expect(html).not.toContain("FastGPT Agent");
  expect(html).not.toContain("message-avatar");
});

test.each([
  ["partial", "部分回复"],
  ["interrupted", "已中断 · 未完成"],
] as const)(
  "%s replies retain their status without a speaker label",
  (status, label) => {
    const html = render([message("assistant", "未完成的内容", status)]);
    expect(html).toContain("未完成的内容");
    expect(html).toContain(label);
    expect(html).not.toContain("FastGPT Agent");
  },
);
