import { test, expect } from "@playwright/test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawn } from "node:child_process";
import { startFixtureModelServer } from "../fixtures/openai-server";
import { launch, configure, latestStatus } from "./helpers";
test("a second application cannot recover or write the first instance active run", async () => {
  const dir = mkdtempSync(join(tmpdir(), "fastgpt-single-")),
    server = await startFixtureModelServer(),
    app = await launch(dir);
  let second: ReturnType<typeof spawn> | undefined;
  try {
    const { page, session } = await configure(app, server.baseUrl),
      run = await page.evaluate(
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
    second = spawn(app.process().spawnfile, [resolve("apps/desktop")], {
      env: { ...process.env, FASTGPT_DESKTOP_TEST_DATA_DIR: dir },
      stdio: "ignore",
    });
    await expect.poll(() => second!.exitCode, { timeout: 3000 }).toBe(0);
    expect(await latestStatus(page, session.id)).toBe("running");
    expect(server.requests).toHaveLength(1);
  } finally {
    if (second && second.exitCode === null) second.kill("SIGKILL");
    await app.close();
    await server.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
