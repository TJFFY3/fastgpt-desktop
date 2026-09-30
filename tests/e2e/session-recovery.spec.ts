import { test, expect } from "@playwright/test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startFixtureModelServer } from "../fixtures/openai-server";
import { configure, launch, latestStatus } from "./helpers";
test("restarts with saved sessions, tool results and a missing session-only key", async () => {
  const dir = mkdtempSync(join(tmpdir(), "fastgpt-recovery-")),
    server = await startFixtureModelServer();
  let app = await launch(dir);
  try {
    const { page, session } = await configure(app, server.baseUrl);
    expect(
      await page.evaluate(
        (id) => window.desktop.providers.test(id),
        session.providerId,
      ),
    ).toEqual({ reachable: true, tools: true });
    await page.evaluate(
      (id) =>
        window.desktop.sessions.update(id, {
          title: "保留的标题",
          pinned: true,
        }),
      session.id,
    );
    const run = await page.evaluate(
      (id) => window.desktop.runs.start(id, "当前时间"),
      session.id,
    );
    await expect.poll(() => latestStatus(page, session.id)).toBe("completed");
    const before = await page.evaluate(
      (id) => window.desktop.sessions.messages(id),
      session.id,
    );
    const events = await page.evaluate(
      (id) => window.desktop.runs.events(id),
      run.id,
    );
    expect(events.filter((e) => e.type === "tool_finished")).toHaveLength(1);
    await app.close();
    app = await launch(dir);
    const reopened = await app.firstWindow();
    await reopened.waitForFunction(() => !!window.desktop);
    expect(
      await reopened.evaluate(
        (id) => window.desktop.sessions.messages(id),
        session.id,
      ),
    ).toEqual(before);
    expect(
      (await reopened.evaluate(() => window.desktop.sessions.list()))[0],
    ).toMatchObject({ title: "保留的标题", pinned: true });
    expect(
      (await reopened.evaluate(() => window.desktop.providers.list()))[0]
        .credentialState,
    ).toBe("missing");
    await expect(
      reopened.getByText("保留的标题", { exact: true }).first(),
    ).toBeVisible();
    await reopened.locator('.recent-row').click();
    await expect(reopened.getByText("此模型需要重新填写密钥。")).toBeVisible();
  } finally {
    await app.close();
    await server.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
test("a real utility-process crash is interrupted without rerunning its request", async () => {
  const dir = mkdtempSync(join(tmpdir(), "fastgpt-crash-")),
    server = await startFixtureModelServer(),
    app = await launch(dir);
  try {
    const { page, session } = await configure(app, server.baseUrl);
    const run = await page.evaluate(
      (id) => window.desktop.runs.start(id, "慢回复"),
      session.id,
    );
    await expect
      .poll(() =>
        page.evaluate(
          async (id) =>
            (await window.desktop.runs.events(id)).some(
              (e) => e.type === "text_delta",
            ),
          run.id,
        ),
      )
      .toBe(true);
    const crashed = await app.evaluate(({ app }) => {
      const worker = app
        .getAppMetrics()
        .find(
          (m) =>
            m.name === "FastGPT Agent" || m.serviceName === "FastGPT Agent",
        );
      if (!worker) return false;
      process.kill(worker.pid, "SIGKILL");
      return true;
    });
    expect(crashed).toBe(true);
    await expect.poll(() => latestStatus(page, session.id)).toBe("interrupted");
    expect(
      (
        await page.evaluate(
          (id) => window.desktop.sessions.messages(id),
          session.id,
        )
      ).at(-1),
    ).toMatchObject({ content: "正在生成", status: "interrupted" });
    expect(server.requests).toHaveLength(1);
  } finally {
    await app.close();
    await server.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
