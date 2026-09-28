export class AppError extends Error {
  constructor(
    public readonly code: string,
    public readonly safeMessage: string,
    public readonly retryable = false,
  ) {
    super(`${code}: ${safeMessage}`);
    this.name = "AppError";
  }
}
export function asAppError(error: unknown): AppError {
  if (error instanceof AppError) return error;
  if (error instanceof Error && error.name === "AbortError")
    return new AppError("ABORTED", "已停止生成");
  return new AppError("INTERNAL", "操作未完成，请重试");
}
export function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw new AppError("ABORTED", "已停止生成");
}
