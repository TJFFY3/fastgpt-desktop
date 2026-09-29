/** Provides the index module for the desktop application. */
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
/** Performs open Store for this module. */
export function openStore(path: string) {
  const db = new Database(path);
  migrate(db);
  const sessions = new SessionRepository(db);
  const attachments = new AttachmentRepository(db, sessions),
    runs = new RunRepository(db, sessions, attachments);
  return {
    credentials: new CredentialRepository(db),
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
/** Defines the store data shape used by this module. */
export type Store = ReturnType<typeof openStore>;
export { namespaceKey } from './namespace';
export { CredentialRepository } from './credential-repository';
export { ProviderRepository } from './provider-repository';
export { SessionRepository } from './session-repository';
export { RunRepository, activeStatuses } from './run-repository';
export { AttachmentRepository, WorkspaceRepository, ApprovalRepository, TranscriptionRepository };
