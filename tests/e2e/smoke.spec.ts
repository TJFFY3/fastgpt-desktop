import { test, expect, _electron } from "@playwright/test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { startFixtureModelServer } from "../fixtures/openai-server";
import { validDraft } from "../fixtures/data";
test("real Electron loads SQLite and completes a tool round trip in its utility worker", async () => {
  const directory = mkdtempSync(join(tmpdir(), "fastgpt-electron-")),
    server = await startFixtureModelServer();
  const app = await _electron.launch({
    args: [resolve("apps/desktop")],
    env: { ...process.env, FASTGPT_DESKTOP_TEST_DATA_DIR: directory },
  });
  try {
    const page = await app.firstWindow();
    await page.waitForFunction(() => !!window.desktop);
    const r = await page.evaluate(
      async (draft) => {
        const p = await window.desktop.providers.save(draft, "fixture-key");
        const s = await window.desktop.sessions.create({
          title: "真实进程测试",
          providerId: p.id,
        });
        const run = await window.desktop.runs.start(s.id, "现在是什么时间");
        return { session: s.id, run: run.id };
      },
      { ...validDraft, baseUrl: server.baseUrl, allowInsecureHttp: true },
    );
    await expect
      .poll(() =>
        page.evaluate(
          async (id) => (await window.desktop.runs.list(id)).at(-1)?.status,
          r.session,
        ),
      )
      .toBe("completed");
    const events = await page.evaluate(
      (id) => window.desktop.runs.events(id),
      r.run,
    );
    expect(
      events.some((e) => e.type === "tool_finished" && !e.result.isError),
    ).toBe(true);
    expect(
      (
        await page.evaluate(
          (id) => window.desktop.sessions.messages(id),
          r.session,
        )
      ).at(-1)?.content,
    ).toContain("测试回复");
  } finally {
    await app.close();
    await server.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
