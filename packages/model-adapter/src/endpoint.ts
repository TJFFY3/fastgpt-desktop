/** Adapts provider-compatible requests and streaming responses to shared model contracts. */
/* 中文：将模型服务商的请求和流式响应转换为项目共享的模型协议。 */
import { AppError } from '../../shared/src/index';
/** Validates or normalizes untrusted input before it crosses this module boundary. */
/* 中文：在不可信输入进入模块前执行校验或规范化处理。 */
export function normalizeChatEndpoint(baseUrl: string): URL {
  let url: URL;
  try {
    url = new URL(baseUrl);
  } catch {
    throw new AppError('INVALID_INPUT', '请填写有效的模型 API 地址');
  }
  if (
    !['https:', 'http:'].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  )
    throw new AppError('INVALID_INPUT', '模型地址仅支持无凭据和查询参数的 HTTP/HTTPS 地址');
  url.pathname = url.pathname.replace(/\/+$/, '');
  if (!url.pathname.endsWith('/chat/completions')) url.pathname += '/chat/completions';
  return url;
}
