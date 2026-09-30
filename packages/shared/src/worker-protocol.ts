/** Defines cross-process contracts, validation, and shared domain primitives. */
/* 中文：定义跨进程共享的数据契约、校验规则和基础业务类型。 */
export { workerCommandSchema, workerReplySchema } from './schemas';
export type { WorkerCommand, WorkerReply } from './types';
