/** Implements namespaced durable storage and record conversion for desktop state. */
/* 中文：按命名空间隔离桌面状态的持久化存储，并转换数据库记录。 */
import { Database } from './database';
import { migrate } from './migrations';
import { CredentialRepository } from './credential-repository';
import { ProviderRepository } from './provider-repository';
import { SessionRepository } from './session-repository';
import { RunRepository } from './run-repository';
import { AttachmentRepository } from './attachment-repository';
import { WorkspaceRepository } from './workspace-repository';
import { ApprovalRepository } from './approval-repository';
import { TranscriptionRepository } from './transcription-repository';
import { FastGptRepository } from './fastgpt-repository';
/** Initializes the module operation and connects it to its required lifecycle dependencies. */
/* 中文：初始化模块操作，并连接执行所需的生命周期依赖。 */
export function openStore(path: string) {
  const db = new Database(path);
  migrate(db);
  const sessions = new SessionRepository(db);
  const attachments = new AttachmentRepository(db, sessions),
    runs = new RunRepository(db, sessions, attachments);
  return {
    credentials: new CredentialRepository(db),
    fastgpt: new FastGptRepository(db),
    providers: new ProviderRepository(db),
    sessions,
    runs,
    attachments,
    workspaces: new WorkspaceRepository(db, sessions),
    approvals: new ApprovalRepository(db, runs),
    transcriptions: new TranscriptionRepository(db),
    transaction: <T>(operation: () => T) => db.transaction(operation),
    close: () => db.close(),
  };
}
/** Defines the data shape exchanged through this module without exposing its implementation. */
/* 中文：定义模块间传递的数据结构，隐藏内部实现细节。 */
export type Store = ReturnType<typeof openStore>;
export { namespaceKey } from './namespace';
export { CredentialRepository } from './credential-repository';
export { ProviderRepository } from './provider-repository';
export { SessionRepository } from './session-repository';
export { RunRepository, activeStatuses } from './run-repository';
export { AttachmentRepository, WorkspaceRepository, ApprovalRepository, TranscriptionRepository };
