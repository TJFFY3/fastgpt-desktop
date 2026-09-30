import { test, expect } from "@playwright/test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startFixtureModelServer } from "../fixtures/openai-server";
import { launch, configure } from "./helpers";
test("session controls and IME preserve the selected conversation safely", async () => {
  const dir = mkdtempSync(join(tmpdir(), "fastgpt-controls-")),
    server = await startFixtureModelServer(),
    app = await launch(dir);
  try {
    const { page, session } = await configure(app, server.baseUrl);
    await page.reload();
    await page.locator('.recent-row').click();
    const composer = page.getByRole("textbox", { name: "消息" });
    await expect(composer).toBeEnabled();
    await composer.fill("你好");
    await composer.evaluate((el) =>
      el.dispatchEvent(
        new CompositionEvent("compositionstart", { bubbles: true }),
      ),
    );
    await composer.press("Enter");
    expect(
      await page.evaluate((id) => window.desktop.runs.list(id), session.id),
    ).toHaveLength(0);
    await composer.evaluate((el) =>
      el.dispatchEvent(
        new CompositionEvent("compositionend", { bubbles: true }),
      ),
    );
    await composer.fill("你好");
    await composer.press("Shift+Enter");
    await expect(composer).toHaveValue("你好\n");
    await composer.press("Enter");
    await expect(page.getByTestId("run-status")).toHaveText("已完成");
    await expect(page.locator('.messages')).toContainText('你好');
    await page.locator('.session-title').click();
    await expect(page.locator('.messages')).toContainText('你好');
    await page.getByLabel("管理会话 恢复会话").click();
    await page.getByRole("button", { name: "重命名", exact: true }).click();
    await page.getByLabel("会话名称").fill("重命名会话");
    await page.getByRole("button", { name: "保存名称" }).click();
    await expect(page.locator(".session-title")).toContainText("重命名会话");
    await page.getByLabel("管理会话 重命名会话").click();
    await expect(page.getByRole('button', { name: '置顶', exact: true })).toBeVisible();
    await page.locator('.chat-header h2').click();
    await expect(page.getByRole('button', { name: '置顶', exact: true })).toBeHidden();
    await page.getByLabel("管理会话 重命名会话").click();
    await page.getByRole("button", { name: "置顶", exact: true }).click();
    await expect(page.locator(".session-title")).toContainText("◆");
    await page.getByLabel("搜索会话").fill("不存在的会话");
    await expect(page.getByText("没有匹配的会话")).toBeVisible();
    await expect(page.locator('.chat-breadcrumb')).toContainText('重命名会话');
    await page.getByLabel("搜索会话").fill("");
    await expect(page.locator(".session-title")).toBeVisible();
  } finally {
    await app.close();
    await server.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
test("archiving or deleting the only session cannot reselect its stale ID", async () => {
  const dir = mkdtempSync(join(tmpdir(), "fastgpt-remove-")),
    server = await startFixtureModelServer(),
    app = await launch(dir);
  try {
    const { page } = await configure(app, server.baseUrl);
    await page.reload();
    await page.locator('.recent-row').click();
    const composer = page.getByRole("textbox", { name: "消息" });
    await expect(composer).toBeEnabled();
    await page.getByLabel("管理会话 恢复会话").click();
    await page.getByRole("button", { name: "归档", exact: true }).click();
    await expect(page.locator(".session-title")).toHaveCount(0);
    await expect(composer).toBeDisabled();
    await page.getByRole("button", { name: "查看归档" }).click();
    await expect(page.locator(".session-title")).toContainText("恢复会话");
    await page.getByLabel("管理会话 恢复会话").click();
    await page.getByRole("button", { name: "取消归档", exact: true }).click();
    await page.getByRole("button", { name: "返回会话" }).click();
    await page.locator(".session-title").click();
    await expect(composer).toBeEnabled();
    await page.getByLabel("管理会话 恢复会话").click();
    page.once("dialog", (dialog) => dialog.accept());
    await page.getByRole("button", { name: "删除", exact: true }).click();
    await expect(page.locator(".session-title")).toHaveCount(0);
    await expect(composer).toBeDisabled();
    await expect(page.locator('.chat-breadcrumb')).toContainText('新对话');
  } finally {
    await app.close();
    await server.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
