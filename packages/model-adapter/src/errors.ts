import { AppError } from "../../shared/src/index";
export function httpError(status: number): AppError {
  if (status === 401 || status === 403)
    return new AppError("AUTH_FAILED", "模型认证失败，请检查密钥和权限");
  if (status === 429)
    return new AppError("RATE_LIMITED", "模型请求过于频繁，请稍后重试", true);
  if (status === 503)
    return new AppError("MODEL_UNAVAILABLE", "模型服务暂时不可用", true);
  return new AppError(
    "MODEL_REQUEST_FAILED",
    `模型服务拒绝请求（HTTP ${status}）`,
  );
}
