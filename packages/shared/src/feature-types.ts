/** Defines cross-process contracts, validation, and shared domain primitives. */
/* 中文：定义跨进程共享的数据契约、校验规则和基础业务类型。 */
import type { CredentialState, ModelCapabilities, ProviderDraft } from './types';

/** Defines the data shape exchanged through this module without exposing its implementation. */
/* 中文：定义模块间传递的数据结构，隐藏内部实现细节。 */
export type RunStartOptions = {
  attachmentIds: string[];
  expectedSessionRevision?: number;
  expectedWorkspaceRevision?: number;
};
/** Defines the data shape exchanged through this module without exposing its implementation. */
/* 中文：定义模块间传递的数据结构，隐藏内部实现细节。 */
export type RunStartRequest = RunStartOptions & { sessionId: string; text: string };
/** Defines the data shape exchanged through this module without exposing its implementation. */
/* 中文：定义模块间传递的数据结构，隐藏内部实现细节。 */
export type ModelSnapshot = Pick<
  ProviderDraft,
  'name' | 'baseUrl' | 'modelId' | 'contextWindow' | 'maxOutputTokens' | 'timeoutMs'
> & {
  providerId: string;
  revision: string;
  capabilities: ModelCapabilities;
  fastgpt?: { appId: string };
};
/** Defines the data shape exchanged through this module without exposing its implementation. */
/* 中文：定义模块间传递的数据结构，隐藏内部实现细节。 */
export type RunTimingSnapshot = { runId: string; elapsedMs: number; active: boolean };
/** Defines the data shape exchanged through this module without exposing its implementation. */
/* 中文：定义模块间传递的数据结构，隐藏内部实现细节。 */
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
/** Defines the data shape exchanged through this module without exposing its implementation. */
/* 中文：定义模块间传递的数据结构，隐藏内部实现细节。 */
export type AttachmentView = Omit<AttachmentRecord, 'snapshotKey'>;
/** Defines the data shape exchanged through this module without exposing its implementation. */
/* 中文：定义模块间传递的数据结构，隐藏内部实现细节。 */
export type WorkspaceView = {
  id: string;
  sessionId: string;
  sourceLabel: string | null;
  revision: number;
  entryCount: number;
  totalBytes: number;
};
/** Defines the data shape exchanged through this module without exposing its implementation. */
/* 中文：定义模块间传递的数据结构，隐藏内部实现细节。 */
export type WorkspaceRecord = WorkspaceView & {
  sourceRoot: string | null;
  baselineKey: string;
  checkpointKey: string;
};
/** Defines the data shape exchanged through this module without exposing its implementation. */
/* 中文：定义模块间传递的数据结构，隐藏内部实现细节。 */
export type FileEntry = {
  relativePath: string;
  kind: 'file' | 'directory';
  size: number;
  sha256: string | null;
};
/** Defines the data shape exchanged through this module without exposing its implementation. */
/* 中文：定义模块间传递的数据结构，隐藏内部实现细节。 */
export type FileListPage = { entries: FileEntry[]; nextCursor: string | null };
/** Defines the data shape exchanged through this module without exposing its implementation. */
/* 中文：定义模块间传递的数据结构，隐藏内部实现细节。 */
export type FileRead = {
  text: string;
  offset: number;
  nextOffset: number;
  remainingBytes: number;
  truncated: boolean;
};
/** Defines the data shape exchanged through this module without exposing its implementation. */
/* 中文：定义模块间传递的数据结构，隐藏内部实现细节。 */
export type WorkspaceDiff = {
  relativePath: string;
  kind: 'added' | 'modified' | 'deleted';
  binary: boolean;
  beforeHash: string | null;
  afterHash: string | null;
};
/** Defines the data shape exchanged through this module without exposing its implementation. */
/* 中文：定义模块间传递的数据结构，隐藏内部实现细节。 */
export type WorkspacePreview = {
  grantId: string;
  entries: FileEntry[];
  excluded: string[];
  entryCount: number;
  totalBytes: number;
  truncated: boolean;
};
/** Defines the data shape exchanged through this module without exposing its implementation. */
/* 中文：定义模块间传递的数据结构，隐藏内部实现细节。 */
export type ApprovalDecision = 'approved' | 'rejected';
/** Defines the data shape exchanged through this module without exposing its implementation. */
/* 中文：定义模块间传递的数据结构，隐藏内部实现细节。 */
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
/** Defines the data shape exchanged through this module without exposing its implementation. */
/* 中文：定义模块间传递的数据结构，隐藏内部实现细节。 */
export type ApprovalRequestView = Omit<ApprovalView, 'id' | 'runId' | 'callId' | 'state'>;
/** Defines the data shape exchanged through this module without exposing its implementation. */
/* 中文：定义模块间传递的数据结构，隐藏内部实现细节。 */
export type ApprovalRecord = {
  view: ApprovalView;
  namespaceKey: string;
  sessionId: string;
  argumentsHash: string;
  createdAt: number;
};
/** Defines the data shape exchanged through this module without exposing its implementation. */
/* 中文：定义模块间传递的数据结构，隐藏内部实现细节。 */
export type SpeechDraft = {
  enabled: boolean;
  name: string;
  baseUrl: string;
  modelId: string;
  timeoutMs: number;
  allowInsecureHttp: boolean;
};
/** Defines the data shape exchanged through this module without exposing its implementation. */
/* 中文：定义模块间传递的数据结构，隐藏内部实现细节。 */
export type SpeechConfig = SpeechDraft & { credentialRef: string | null; revision: string };
/** Defines the data shape exchanged through this module without exposing its implementation. */
/* 中文：定义模块间传递的数据结构，隐藏内部实现细节。 */
export type SpeechView = SpeechDraft & { credentialState: CredentialState };
/** Defines the data shape exchanged through this module without exposing its implementation. */
/* 中文：定义模块间传递的数据结构，隐藏内部实现细节。 */
export type AudioSubmission = {
  sessionId: string;
  operationId: string;
  mimeType: string;
  bytes: Uint8Array;
};
/** Defines the data shape exchanged through this module without exposing its implementation. */
/* 中文：定义模块间传递的数据结构，隐藏内部实现细节。 */
export type ExportResult = {
  path: string;
  status: 'written' | 'deleted' | 'skipped' | 'conflict' | 'failed';
  backupId: string | null;
  errorCode: string | null;
};
/** Defines the data shape exchanged through this module without exposing its implementation. */
/* 中文：定义模块间传递的数据结构，隐藏内部实现细节。 */
export type BackupView = {
  id: string;
  workspaceId: string;
  name: string;
  size: number;
  createdAt: number;
};
/** Defines the data shape exchanged through this module without exposing its implementation. */
/* 中文：定义模块间传递的数据结构，隐藏内部实现细节。 */
export type ExportSelection = { path: string; action: 'write' | 'delete' | 'skip' };
/** Defines the data shape exchanged through this module without exposing its implementation. */
/* 中文：定义模块间传递的数据结构，隐藏内部实现细节。 */
export type ExportPreview = { token: string; changes: WorkspaceDiff[]; conflicts: string[] };
/** Defines the data shape exchanged through this module without exposing its implementation. */
/* 中文：定义模块间传递的数据结构，隐藏内部实现细节。 */
export type SandboxAvailability = {
  available: boolean;
  reason: string | null;
  imageReady: boolean;
};
/** Defines the data shape exchanged through this module without exposing its implementation. */
/* 中文：定义模块间传递的数据结构，隐藏内部实现细节。 */
export type CommandFinishReason =
  'exited' | 'timeout' | 'cancelled' | 'output_limit' | 'oom' | 'failed';
/** Defines the data shape exchanged through this module without exposing its implementation. */
/* 中文：定义模块间传递的数据结构，隐藏内部实现细节。 */
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
/** Specifies the contract callers must satisfy at this module boundary. */
/* 中文：定义调用方在模块边界需要遵守的接口契约。 */
export interface SandboxFileBridge {
  manifest(key: string): Promise<FileEntry[]>;
  read(key: string, path: string): AsyncIterable<Uint8Array>;
  createSnapshot(): Promise<string>;
  write(key: string, path: string, data: AsyncIterable<Uint8Array>): Promise<void>;
  discard(key: string): Promise<void>;
}
/** Specifies the contract callers must satisfy at this module boundary. */
/* 中文：定义调用方在模块边界需要遵守的接口契约。 */
export interface AttachmentApi {
  pick(sessionId: string): Promise<AttachmentView[]>;
  importDropped(sessionId: string, files: File[]): Promise<AttachmentView[]>;
  list(sessionId: string): Promise<AttachmentView[]>;
  removeDraft(id: string): Promise<void>;
}
/** Specifies the contract callers must satisfy at this module boundary. */
/* 中文：定义调用方在模块边界需要遵守的接口契约。 */
export interface WorkspaceApi {
  ensure(sessionId: string): Promise<WorkspaceView>;
  previewSelection(sessionId: string): Promise<WorkspacePreview>;
  importSelection(sessionId: string, grantId: string): Promise<WorkspaceView>;
  list(sessionId: string, cursor?: string): Promise<FileListPage>;
  read(sessionId: string, path: string, offset: number, maxBytes: number): Promise<FileRead>;
  diff(sessionId: string): Promise<WorkspaceDiff[]>;
}
/** Specifies the contract callers must satisfy at this module boundary. */
/* 中文：定义调用方在模块边界需要遵守的接口契约。 */
export interface ApprovalApi {
  decide(id: string, decision: ApprovalDecision): Promise<void>;
}
/** Specifies the contract callers must satisfy at this module boundary. */
/* 中文：定义调用方在模块边界需要遵守的接口契约。 */
export interface ExportApi {
  preview(sessionId: string, paths: string[]): Promise<ExportPreview>;
  apply(token: string, selections: ExportSelection[]): Promise<ExportResult[]>;
  exportToChosenDirectory(sessionId: string, paths: string[]): Promise<ExportResult[]>;
  listBackups(workspaceId: string): Promise<BackupView[]>;
  restoreBackup(backupId: string): Promise<ExportResult>;
  removeBackups(ids: string[]): Promise<void>;
}
/** Specifies the contract callers must satisfy at this module boundary. */
/* 中文：定义调用方在模块边界需要遵守的接口契约。 */
export interface SpeechApi {
  get(): Promise<SpeechView>;
  save(draft: SpeechDraft, apiKey?: string): Promise<SpeechView>;
  beginCapture(sessionId: string): Promise<{ operationId: string }>;
  submit(audio: AudioSubmission): Promise<{ operationId: string; text: string }>;
  cancel(operationId: string): Promise<void>;
}
/** Specifies the contract callers must satisfy at this module boundary. */
/* 中文：定义调用方在模块边界需要遵守的接口契约。 */
export interface SandboxApi {
  detect(): Promise<SandboxAvailability>;
  prepareImage(): Promise<{ imageId: string }>;
}
