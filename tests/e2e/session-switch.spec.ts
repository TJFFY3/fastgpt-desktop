import { test, expect } from "@playwright/test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startFixtureModelServer } from "../fixtures/openai-server";
import { launch, configure } from "./helpers";
test("a delayed start for A cannot overwrite B after selection changes", async () => {
  const dir = mkdtempSync(join(tmpdir(), "fastgpt-switch-")),
    server = await startFixtureModelServer(),
    app = await launch(dir, { FASTGPT_DESKTOP_TEST_START_DELAY_MS: "1000" });
  try {
    const { page, provider } = await configure(app, server.baseUrl);
    await page.evaluate(
      (id) =>
        window.desktop.sessions.create({ title: "会话 B", providerId: id }),
      provider.id,
    );
    await page.reload();
    await page.getByRole("button", { name: /恢复会话/ }).click();
    await page
      .getByRole("textbox", { name: "消息" })
      .fill("慢回复，只属于会话 A");
    await page.getByRole("button", { name: "发送", exact: true }).click();
    await page.getByRole("button", { name: /会话 B/ }).click();
    await expect(page.locator(".chat-header h2")).toHaveText("会话 B");
    await expect.poll(() => server.requests.length).toBe(1);
    await expect(page.locator(".chat-scroll")).not.toContainText(
      "慢回复，只属于会话 A",
    );
    await expect(page.getByTestId("run-status")).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "停止", exact: true }),
    ).toHaveCount(0);
  } finally {
    await app.close();
    await server.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
