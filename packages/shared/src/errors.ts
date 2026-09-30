/** Owns the module boundary represented by app Error and coordinates its collaborators. */
/* 中文：携带应用错误码及可向用户安全展示的错误信息。 */
/** Defines cross-process contracts, validation, and shared domain primitives. */
/* 中文：定义跨进程共享的数据契约、校验规则和基础业务类型。 */
export class AppError extends Error {
  constructor(
    public readonly code: string,
    public readonly safeMessage: string,
    public readonly retryable = false,
  ) {
    super(`${code}: ${safeMessage}`);
    this.name = 'AppError';
  }
}
/** Implements one focused part of this module’s public responsibility. */
export function asAppError(error: unknown): AppError {
  if (error instanceof AppError) return error;
  if (error instanceof Error && error.name === 'AbortError')
    return new AppError('ABORTED', '已停止生成');
  return new AppError('INTERNAL', '操作未完成，请重试');
}
/** Implements one focused part of this module’s public responsibility. */
export function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw new AppError('ABORTED', '已停止生成');
}
