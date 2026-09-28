import { test, expect, _electron } from "@playwright/test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { startFixtureModelServer } from "../fixtures/openai-server";
test("Chinese UI configures a model, executes a tool and stops streaming", async ({}, info) => {
  const directory = mkdtempSync(join(tmpdir(), "fastgpt-ui-")),
    server = await startFixtureModelServer();
  const app = await _electron.launch({
    args: [resolve("apps/desktop")],
    env: { ...process.env, FASTGPT_DESKTOP_TEST_DATA_DIR: directory },
  });
  try {
    const page = await app.firstWindow();
    await page
      .getByRole("button", { name: "模型设置", exact: true })
      .click({ timeout: 2000 });
    await page.getByLabel("模型名称", { exact: true }).fill("本地测试模型");
    await page.getByLabel("Base URL", { exact: true }).fill(server.baseUrl);
    await page.getByLabel("模型 ID", { exact: true }).fill("fixture-model");
    await page.getByLabel("API Key", { exact: true }).fill("fixture-ui-secret");
    await page.getByLabel("允许明文 HTTP（仅可信服务）").check();
    await page.getByLabel("支持工具调用").check();
    await page.getByRole("button", { name: "保存配置", exact: true }).click();
    await expect(
      page.getByText("密钥仅本次运行可用", { exact: true }).first(),
    ).toBeVisible();
    await page.getByRole("button", { name: "关闭设置" }).click();
    await page.getByRole("button", { name: "新建会话", exact: true }).click();
    await page.getByRole("textbox", { name: "消息" }).fill("现在是什么时间");
    await page.getByRole("button", { name: "发送", exact: true }).click();
    await expect(page.getByTestId("run-status")).toHaveText("已完成");
    await expect(
      page.getByText("工具执行成功，这是测试回复。", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText("get_current_time", { exact: true }).first(),
    ).toBeVisible();
    const userBounds = await page
      .locator(".message.user")
      .last()
      .evaluate((row) => {
        const bubble = row.querySelector(".message-body")!.getBoundingClientRect();
        const bounds = row.getBoundingClientRect();
        return {
          rightGap: bounds.right - bubble.right,
          leftGap: bubble.left - bounds.left,
          width: bubble.width,
          rowWidth: bounds.width,
        };
      });
    expect(userBounds.rightGap).toBeLessThanOrEqual(1);
    expect(userBounds.leftGap).toBeGreaterThan(20);
    expect(userBounds.width).toBeLessThan(userBounds.rowWidth * 0.9);
    const assistantBounds = await page
      .locator(".message.assistant")
      .last()
      .evaluate((row) => {
        const bubble = row.querySelector(".message-body")!.getBoundingClientRect();
        const bounds = row.getBoundingClientRect();
        return {
          leftGap: bubble.left - bounds.left,
          rightGap: bounds.right - bubble.right,
        };
      });
    expect(assistantBounds.leftGap).toBeLessThanOrEqual(1);
    expect(assistantBounds.rightGap).toBeGreaterThan(20);
    await expect(page.locator(".message-avatar")).toHaveCount(0);
    await expect(page.getByText("FastGPT Agent", { exact: true })).toHaveCount(0);
    await expect(page.getByText("你", { exact: true })).toHaveCount(0);
    await page.getByRole("textbox", { name: "消息" }).fill("慢一点回复");
    await page.getByRole("button", { name: "发送", exact: true }).click();
    await expect(
      page.locator("p").filter({ hasText: /^正在生成$/ }),
    ).toBeVisible();
    await expect(page.locator(".streaming .message-body")).toContainText(
      "正在生成",
    );
    await expect(page.locator(".streaming")).not.toContainText("FastGPT Agent");
    expect(
      await page.locator(".streaming").evaluate(
        (row) =>
          row.querySelector(".message-body")!.getBoundingClientRect().left -
          row.getBoundingClientRect().left,
      ),
    ).toBeLessThanOrEqual(1);
    await page.getByRole("button", { name: "停止", exact: true }).click();
    await expect(page.getByTestId("run-status")).toHaveText("已取消");
    await expect(page.locator(".message.assistant").last()).toContainText(
      "部分回复",
    );

    await app.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0].setContentSize(920, 760);
    });
    await expect.poll(() => page.evaluate(() => window.innerWidth)).toBe(920);
    const longMessage = `这是用于检查换行的长消息。\n${"long-unbroken-text".repeat(40)}`;
    await page.getByRole("textbox", { name: "消息" }).fill(longMessage);
    await page.getByRole("button", { name: "发送", exact: true }).click();
    await expect(page.getByTestId("run-status")).toHaveText("已完成");
    await expect(page.locator(".message.user").last().locator("p")).toHaveText(
      longMessage,
    );
    const wrapped = await page.locator(".message.user").last().evaluate((row) => {
      const bubble = row.querySelector(".message-body")!;
      const text = bubble.querySelector("p")!;
      const bounds = row.getBoundingClientRect();
      const bubbleBounds = bubble.getBoundingClientRect();
      return {
        rightGap: bounds.right - bubbleBounds.right,
        width: bubbleBounds.width,
        rowWidth: bounds.width,
        horizontalOverflow: text.scrollWidth - text.clientWidth,
        lineHeight: parseFloat(getComputedStyle(text).lineHeight),
        textHeight: text.getBoundingClientRect().height,
      };
    });
    expect(wrapped.rightGap).toBeLessThanOrEqual(1);
    expect(wrapped.width).toBeLessThan(wrapped.rowWidth * 0.9);
    expect(wrapped.horizontalOverflow).toBeLessThanOrEqual(1);
    expect(wrapped.textHeight).toBeGreaterThan(wrapped.lineHeight * 2);
    expect(
      await page.evaluate(() => JSON.stringify([localStorage, sessionStorage])),
    ).not.toContain("fixture-ui-secret");
    await page.screenshot({ path: info.outputPath("desktop.png") });
  } finally {
    await app.close();
    await server.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
