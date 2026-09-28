import { test, expect } from "@playwright/test";
import { mkdtempSync, rmSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { startFixtureModelServer } from "../fixtures/openai-server";
import { configure, launch, latestStatus } from "./helpers";
test("renderer has only the narrow bridge, CSP blocks network and keys stay off disk/events", async () => {
  const dir = mkdtempSync(join(tmpdir(), "fastgpt-security-")),
    server = await startFixtureModelServer(),
    app = await launch(dir);
  try {
    const { page, session } = await configure(app, server.baseUrl);
    expect(
      await page.evaluate(() => ({
        require: typeof (globalThis as any).require,
        process: typeof (globalThis as any).process,
        keys: Object.keys(window.desktop),
      })),
    ).toEqual({
      require: "undefined",
      process: "undefined",
      keys: ["attachments", "providers", "sessions", "runs", "onRunEvent"],
    });
    expect(await page.evaluate(()=>Object.keys(window.desktop.attachments))).toEqual(["pick","importDropped","list","removeDraft"]);
    const sandboxed = await app.evaluate(({ app, BrowserWindow }) => {
      const pid = BrowserWindow.getAllWindows()[0].webContents.getOSProcessId();
      return app.getAppMetrics().find((m) => m.pid === pid)?.sandboxed;
    });
    expect(sandboxed).toBe(true);
    expect(
      await page.evaluate(async (url) => {
        try {
          await fetch(url);
          return "allowed";
        } catch {
          return "blocked";
        }
      }, server.baseUrl),
    ).toBe("blocked");
    const injection = await page.evaluate(async (id) => {
      try {
        await (window.desktop.runs.start as any)({
          sessionId: id,
          text: "x",
          namespace: "victim",
        });
        return "accepted";
      } catch (e) {
        return String(e);
      }
    }, session.id);
    expect(injection).toContain("INVALID_INPUT");
    const run = await page.evaluate(
      (id) => window.desktop.runs.start(id, "<img src=x onerror=alert(1)>"),
      session.id,
    );
    await expect.poll(() => latestStatus(page, session.id)).toBe("completed");
    const events = await page.evaluate(
      (id) => window.desktop.runs.events(id),
      run.id,
    );
    expect(JSON.stringify(events)).not.toContain("e2e-private-test-key");
    for (const file of readdirSync(dir).filter((f) =>
      f.startsWith("fastgpt.sqlite"),
    ))
      expect(
        readFileSync(join(dir, file)).includes(
          Buffer.from("e2e-private-test-key"),
        ),
      ).toBe(false);
    await page.reload();
    await page.waitForFunction(() => !!window.desktop);
    await expect(
      page.getByText("<img src=x onerror=alert(1)>", { exact: true }),
    ).toBeVisible();
    expect(await page.locator(".messages img").count()).toBe(0);
    const mainFile = readFileSync(
      join(process.cwd(), "apps/desktop/out/main/index.js"),
      "utf8",
    );
    expect(mainFile).not.toContain("ELECTRON_RENDERER_URL");
  } finally {
    await app.close();
    await server.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
