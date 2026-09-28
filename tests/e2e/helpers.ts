import {
  _electron,
  type ElectronApplication,
  type Page,
} from "@playwright/test";
import { resolve } from "node:path";
import { validDraft } from "../fixtures/data";
export const launch = (
  directory: string,
  extraEnv: Record<string, string> = {},
) =>
  _electron.launch({
    args: [resolve("apps/desktop")],
    env: {
      ...process.env,
      ...extraEnv,
      FASTGPT_DESKTOP_TEST_DATA_DIR: directory,
    },
  });
export async function configure(app: ElectronApplication, baseUrl: string) {
  const page = await app.firstWindow();
  await page.waitForFunction(() => !!window.desktop);
  const provider = await page.evaluate(
    (draft) => window.desktop.providers.save(draft, "e2e-private-test-key"),
    { ...validDraft, baseUrl, allowInsecureHttp: true },
  );
  const session = await page.evaluate(
    (id) =>
      window.desktop.sessions.create({ title: "恢复会话", providerId: id }),
    provider.id,
  );
  return { page, provider, session };
}
export const latestStatus = (page: Page, id: string) =>
  page.evaluate(
    async (sessionId) =>
      (await window.desktop.runs.list(sessionId)).at(-1)?.status,
    id,
  );
