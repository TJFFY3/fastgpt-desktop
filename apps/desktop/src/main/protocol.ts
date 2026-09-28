import { resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { AppError } from "../../../../packages/shared/src/index";
export const productionCsp =
  "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self'; connect-src 'none'; object-src 'none'; base-uri 'none'; frame-src 'none'; form-action 'none'";
export function resourcePath(value: string, root: string) {
  const url = new URL(value);
  let pathname: string;
  try {
    pathname = decodeURIComponent(url.pathname);
  } catch {
    throw new AppError("FORBIDDEN", "无效资源路径");
  }
  if (
    url.protocol !== "app:" ||
    url.hostname !== "desktop" ||
    url.port ||
    url.username ||
    url.password ||
    /%2f|%5c/i.test(url.pathname) ||
    pathname.includes("\0") ||
    pathname.includes("\\") ||
    pathname.split("/").includes("..")
  )
    throw new AppError("FORBIDDEN", "不允许的资源路径");
  const base = resolve(root),
    path = resolve(base, `.${pathname === "/" ? "/index.html" : pathname}`);
  if (!path.startsWith(base + sep))
    throw new AppError("FORBIDDEN", "资源路径越界");
  return path;
}
export async function installProtocol(root: string) {
  const { protocol, net } = await import("electron");
  protocol.handle("app", async (request) => {
    try {
      const response = await net.fetch(
        pathToFileURL(resourcePath(request.url, root)).href,
      );
      const headers = new Headers(response.headers);
      headers.set("Content-Security-Policy", productionCsp);
      headers.set("X-Content-Type-Options", "nosniff");
      return new Response(response.body, { status: response.status, headers });
    } catch {
      return new Response("Not found", { status: 404 });
    }
  });
}
