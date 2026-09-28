import { expect, it } from "vitest";
import { windowOptions, safeExternalUrl } from "../src/main/window";
import { resourcePath, productionCsp } from "../src/main/protocol";
it("isolates the renderer and permits only ordinary external web links", () => {
  expect(windowOptions("/preload.js").webPreferences).toMatchObject({
    nodeIntegration: false,
    contextIsolation: true,
    sandbox: true,
    webSecurity: true,
  });
  expect(safeExternalUrl("https://example.com")).toBe(true);
  for (const url of [
    "file:///secret",
    "javascript:alert(1)",
    "https://u:p@example.com",
    "fastgpt://callback",
  ])
    expect(safeExternalUrl(url)).toBe(false);
});
it("maps only packaged assets and denies decoded traversal or other origins", () => {
  expect(resourcePath("app://desktop/assets/app.js", "/renderer")).toBe(
    "/renderer/assets/app.js",
  );
  for (const url of [
    "app://other/index.html",
    "app://desktop/%2e%2e%2fsecret",
    "app://desktop/assets/%2fetc/passwd",
    "app://desktop/%00",
  ])
    expect(() => resourcePath(url, "/renderer")).toThrow(/FORBIDDEN/);
  expect(productionCsp).toContain("connect-src 'none'");
  expect(productionCsp).not.toContain("unsafe-inline");
});
