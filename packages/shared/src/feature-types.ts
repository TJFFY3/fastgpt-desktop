/** Provides the feature types module for the desktop application. */
import type { CredentialState, ModelCapabilities, ProviderDraft } from './types';

/** Defines the run Start Options data shape used by this module. */
export type RunStartOptions = {
  attachmentIds: string[];
  expectedSessionRevision?: number;
  expectedWorkspaceRevision?: number;
};
/** Defines the run Start Request data shape used by this module. */
export type RunStartRequest = RunStartOptions & { sessionId: string; text: string };
/** Defines the model Snapshot data shape used by this module. */
export type ModelSnapshot = Pick<
  ProviderDraft,
  'name' | 'baseUrl' | 'modelId' | 'contextWindow' | 'maxOutputTokens' | 'timeoutMs'
> & { providerId: string; revision: string; capabilities: ModelCapabilities };
/** Defines the run Timing Snapshot data shape used by this module. */
export type RunTimingSnapshot = { runId: string; elapsedMs: number; active: boolean };
/** Defines the attachment Record data shape used by this module. */
export type AttachmentRecord = {
  id: string;
  sessionId: string;
  name: string;
  size: number;
  sha256: string;
  kind: 'text' | 'binary';
  state: 'ready' | 'sent';
  snapshotKey: string;
};
/** Defines the attachment View data shape used by this module. */
export type AttachmentView = Omit<AttachmentRecord, 'snapshotKey'>;
/** Defines the workspace View data shape used by this module. */
export type WorkspaceView = {
  id: string;
  sessionId: string;
  sourceLabel: string | null;
  revision: number;
  entryCount: number;
  totalBytes: number;
};
/** Defines the workspace Record data shape used by this module. */
export type WorkspaceRecord = WorkspaceView & {
  sourceRoot: string | null;
  baselineKey: string;
  checkpointKey: string;
};
/** Defines the file Entry data shape used by this module. */
export type FileEntry = {
  relativePath: string;
  kind: 'file' | 'directory';
  size: number;
  sha256: string | null;
};
/** Defines the file List Page data shape used by this module. */
export type FileListPage = { entries: FileEntry[]; nextCursor: string | null };
/** Defines the file Read data shape used by this module. */
export type FileRead = {
  text: string;
  offset: number;
  nextOffset: number;
  remainingBytes: number;
  truncated: boolean;
};
/** Defines the workspace Diff data shape used by this module. */
export type WorkspaceDiff = {
  relativePath: string;
  kind: 'added' | 'modified' | 'deleted';
  binary: boolean;
  beforeHash: string | null;
  afterHash: string | null;
};
/** Defines the workspace Preview data shape used by this module. */
export type WorkspacePreview = {
  grantId: string;
  entries: FileEntry[];
  excluded: string[];
  entryCount: number;
  totalBytes: number;
  truncated: boolean;
};
/** Defines the approval Decision data shape used by this module. */
export type ApprovalDecision = 'approved' | 'rejected';
/** Defines the approval View data shape used by this module. */
export type ApprovalView = {
  id: string;
  runId: string;
  callId: string;
  kind: 'file_read' | 'file_write' | 'command';
  relativePath: string | null;
  command: string | null;
  arguments: string;
  destinationLabel: string;
  state: 'pending' | ApprovalDecision | 'revoked';
};
/** Defines the approval Request View data shape used by this module. */
export type ApprovalRequestView = Omit<ApprovalView, 'id' | 'runId' | 'callId' | 'state'>;
/** Defines the approval Record data shape used by this module. */
export type ApprovalRecord = {
  view: ApprovalView;
  namespaceKey: string;
  sessionId: string;
  argumentsHash: string;
  createdAt: number;
};
/** Defines the speech Draft data shape used by this module. */
export type SpeechDraft = {
  enabled: boolean;
  name: string;
  baseUrl: string;
  modelId: string;
  timeoutMs: number;
  allowInsecureHttp: boolean;
};
/** Defines the speech Config data shape used by this module. */
export type SpeechConfig = SpeechDraft & { credentialRef: string | null; revision: string };
/** Defines the speech View data shape used by this module. */
export type SpeechView = SpeechDraft & { credentialState: CredentialState };
/** Defines the audio Submission data shape used by this module. */
export type AudioSubmission = {
  sessionId: string;
  operationId: string;
  mimeType: string;
  bytes: Uint8Array;
};
/** Defines the export Result data shape used by this module. */
export type ExportResult = {
  path: string;
  status: 'written' | 'deleted' | 'skipped' | 'conflict' | 'failed';
  backupId: string | null;
  errorCode: string | null;
};
/** Defines the backup View data shape used by this module. */
export type BackupView = {
  id: string;
  workspaceId: string;
  name: string;
  size: number;
  createdAt: number;
};
/** Defines the export Selection data shape used by this module. */
export type ExportSelection = { path: string; action: 'write' | 'delete' | 'skip' };
/** Defines the export Preview data shape used by this module. */
export type ExportPreview = { token: string; changes: WorkspaceDiff[]; conflicts: string[] };
/** Defines the sandbox Availability data shape used by this module. */
export type SandboxAvailability = {
  available: boolean;
  reason: string | null;
  imageReady: boolean;
};
/** Defines the command Finish Reason data shape used by this module. */
export type CommandFinishReason =
  'exited' | 'timeout' | 'cancelled' | 'output_limit' | 'oom' | 'failed';
/** Defines the feature Agent Event data shape used by this module. */
export type FeatureAgentEvent =
  | { type: 'reasoning_delta'; text: string }
  | { type: 'reasoning_truncated'; limitBytes: number }
  | { type: 'approval_requested'; approval: ApprovalView }
  | { type: 'approval_decided'; approvalId: string; decision: ApprovalDecision | 'revoked' }
  | { type: 'command_started'; id: string; command: string; cwd: string }
  | { type: 'command_output'; id: string; channel: 'stdout' | 'stderr'; text: string }
  | {
      type: 'command_finished';
      id: string;
      exitCode: number | null;
      elapsedMs: number;
      reason: CommandFinishReason;
      truncated: boolean;
    }
  | { type: 'workspace_checkpoint'; id: string; workspaceId: string; revision: number };
/** Describes the sandbox File Bridge contract used by this module. */
export interface SandboxFileBridge {
  manifest(key: string): Promise<FileEntry[]>;
  read(key: string, path: string): AsyncIterable<Uint8Array>;
  createSnapshot(): Promise<string>;
  write(key: string, path: string, data: AsyncIterable<Uint8Array>): Promise<void>;
  discard(key: string): Promise<void>;
}
/** Describes the attachment Api contract used by this module. */
export interface AttachmentApi {
  pick(sessionId: string): Promise<AttachmentView[]>;
  importDropped(sessionId: string, files: File[]): Promise<AttachmentView[]>;
  list(sessionId: string): Promise<AttachmentView[]>;
  removeDraft(id: string): Promise<void>;
}
/** Describes the workspace Api contract used by this module. */
export interface WorkspaceApi {
  ensure(sessionId: string): Promise<WorkspaceView>;
  previewSelection(sessionId: string): Promise<WorkspacePreview>;
  importSelection(sessionId: string, grantId: string): Promise<WorkspaceView>;
  list(sessionId: string, cursor?: string): Promise<FileListPage>;
  read(sessionId: string, path: string, offset: number, maxBytes: number): Promise<FileRead>;
  diff(sessionId: string): Promise<WorkspaceDiff[]>;
}
/** Describes the approval Api contract used by this module. */
export interface ApprovalApi {
  decide(id: string, decision: ApprovalDecision): Promise<void>;
}
/** Describes the export Api contract used by this module. */
export interface ExportApi {
  preview(sessionId: string, paths: string[]): Promise<ExportPreview>;
  apply(token: string, selections: ExportSelection[]): Promise<ExportResult[]>;
  exportToChosenDirectory(sessionId: string, paths: string[]): Promise<ExportResult[]>;
  listBackups(workspaceId: string): Promise<BackupView[]>;
  restoreBackup(backupId: string): Promise<ExportResult>;
  removeBackups(ids: string[]): Promise<void>;
}
/** Describes the speech Api contract used by this module. */
export interface SpeechApi {
  get(): Promise<SpeechView>;
  save(draft: SpeechDraft, apiKey?: string): Promise<SpeechView>;
  beginCapture(sessionId: string): Promise<{ operationId: string }>;
  submit(audio: AudioSubmission): Promise<{ operationId: string; text: string }>;
  cancel(operationId: string): Promise<void>;
}
/** Describes the sandbox Api contract used by this module. */
export interface SandboxApi {
  detect(): Promise<SandboxAvailability>;
  prepareImage(): Promise<{ imageId: string }>;
}
