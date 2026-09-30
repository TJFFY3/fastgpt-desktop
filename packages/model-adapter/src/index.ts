/** Adapts provider-compatible requests and streaming responses to shared model contracts. */
/* 中文：将模型服务商的请求和流式响应转换为项目共享的模型协议。 */
export { normalizeChatEndpoint } from './endpoint';
export { parseSse } from './sse';
export { OpenAiChatAdapter } from './chat-completions';
