/** Adapts provider-compatible requests and streaming responses to shared model contracts. */
/* 中文：将模型服务商的请求和流式响应转换为项目共享的模型协议。 */
import { AppError } from '../../shared/src/index';
/** Implements one focused part of this module’s public responsibility. */
/* 中文：实现本模块职责中的一项具体操作。 */
export function httpError(status: number): AppError {
  if (status === 401 || status === 403)
    return new AppError('AUTH_FAILED', '模型认证失败，请检查密钥和权限');
  if (status === 429) return new AppError('RATE_LIMITED', '模型请求过于频繁，请稍后重试', true);
  if (status === 503) return new AppError('MODEL_UNAVAILABLE', '模型服务暂时不可用', true);
  return new AppError('MODEL_REQUEST_FAILED', `模型服务拒绝请求（HTTP ${status}）`);
}
