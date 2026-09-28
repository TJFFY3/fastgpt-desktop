import type { CredentialState, ModelCapabilities, ProviderDraft } from "./types";

export type RunStartOptions = { attachmentIds: string[]; expectedSessionRevision?: number; expectedWorkspaceRevision?: number };
export type RunStartRequest = RunStartOptions & { sessionId: string; text: string };
export type ModelSnapshot = Pick<ProviderDraft, "name" | "baseUrl" | "modelId" | "contextWindow" | "maxOutputTokens" | "timeoutMs"> & { providerId: string; revision: string; capabilities: ModelCapabilities };
export type RunTimingSnapshot = { runId: string; elapsedMs: number; active: boolean };
export type AttachmentRecord = { id: string; sessionId: string; name: string; size: number; sha256: string; kind: "text" | "binary"; state: "ready" | "sent"; snapshotKey: string };
export type AttachmentView = Omit<AttachmentRecord, "snapshotKey">;
export type WorkspaceView = { id: string; sessionId: string; sourceLabel: string | null; revision: number; entryCount: number; totalBytes: number };
export type WorkspaceRecord = WorkspaceView & { sourceRoot: string | null; sourceIdentity?:{device:string;inode:string}|null; baselineKey: string; checkpointKey: string };
export type FileEntry = { relativePath: string; kind: "file" | "directory"; size: number; sha256: string | null };
export type FileListPage = { entries: FileEntry[]; nextCursor: string | null };
export type FileRead = { text: string; offset: number; nextOffset: number; remainingBytes: number; truncated: boolean };
export type WorkspaceDiff = { relativePath: string; kind: "added" | "modified" | "deleted"; binary: boolean; beforeHash: string | null; afterHash: string | null };
export type WorkspacePreview = { grantId: string; entries: FileEntry[]; excluded: string[]; entryCount: number; totalBytes: number; truncated: boolean };
export type ApprovalDecision = "approved" | "rejected";
export type ApprovalView = { id: string; runId: string; callId: string; kind: "file_read" | "file_write" | "command"; relativePath: string | null; command: string | null; arguments: string; destinationLabel: string; state: "pending" | ApprovalDecision | "revoked" };
export type ApprovalRequestView = Omit<ApprovalView, "id" | "runId" | "callId" | "state">;
export type ApprovalRecord = { view: ApprovalView; namespaceKey: string; sessionId: string; argumentsHash: string; createdAt: number };
export type SpeechDraft = { enabled: boolean; name: string; baseUrl: string; modelId: string; timeoutMs: number; allowInsecureHttp: boolean };
export type SpeechConfig = SpeechDraft & { credentialRef: string | null; revision: string };
export type SpeechView = SpeechDraft & { credentialState: CredentialState };
export type AudioSubmission = { sessionId: string; operationId: string; mimeType: string; bytes: Uint8Array };
export type ExportResult = { path: string; status: "written" | "deleted" | "skipped" | "conflict" | "failed"; backupId: string | null; errorCode: string | null };
export type BackupView = { id: string; workspaceId: string; name: string; size: number; createdAt: number };
export type ExportSelection = { path: string; action: "write" | "delete" | "skip" };
export type ExportPreview = { token: string; changes: WorkspaceDiff[]; conflicts: string[] };
export type SandboxAvailability = { available: boolean; reason: string | null; imageReady: boolean };
export type CommandFinishReason = "exited" | "timeout" | "cancelled" | "output_limit" | "oom" | "failed";
export type FeatureAgentEvent =
  | { type: "reasoning_delta"; text: string }
  | { type: "reasoning_truncated"; limitBytes: number }
  | { type: "approval_requested"; approval: ApprovalView }
  | { type: "approval_decided"; approvalId: string; decision: ApprovalDecision | "revoked" }
  | { type: "command_started"; id: string; command: string; cwd: string }
  | { type: "command_output"; id: string; channel: "stdout" | "stderr"; text: string }
  | { type: "command_finished"; id: string; exitCode: number | null; elapsedMs: number; reason: CommandFinishReason; truncated: boolean }
  | { type: "workspace_checkpoint"; id: string; workspaceId: string; revision: number };
export interface SandboxFileBridge {
  manifest(key: string): Promise<FileEntry[]>;
  read(key: string, path: string): AsyncIterable<Uint8Array>;
  createSnapshot(): Promise<string>;
  write(key: string, path: string, data: AsyncIterable<Uint8Array>): Promise<void>;
  directory(key: string, path: string): Promise<void>;
  discard(key: string): Promise<void>;
}
export interface AttachmentApi {
  pick(sessionId: string): Promise<AttachmentView[]>;
  importDropped(sessionId: string, files: File[]): Promise<AttachmentView[]>;
  list(sessionId: string): Promise<AttachmentView[]>;
  removeDraft(id: string): Promise<void>;
}
export interface WorkspaceApi {
  ensure(sessionId: string): Promise<WorkspaceView>;
  previewSelection(sessionId: string): Promise<WorkspacePreview>;
  importSelection(sessionId: string, grantId: string): Promise<WorkspaceView>;
  list(sessionId: string, cursor?: string): Promise<FileListPage>;
  read(sessionId: string, path: string, offset: number, maxBytes: number): Promise<FileRead>;
  diff(sessionId: string): Promise<WorkspaceDiff[]>;
}
export interface ApprovalApi { decide(id: string, decision: ApprovalDecision): Promise<void> }
export interface ExportApi {
  preview(sessionId: string, paths: string[]): Promise<ExportPreview>;
  apply(token: string, selections: ExportSelection[]): Promise<ExportResult[]>;
  exportToChosenDirectory(sessionId: string, paths: string[]): Promise<ExportResult[]>;
  listBackups(workspaceId?: string): Promise<BackupView[]>;
  restoreBackup(backupId: string): Promise<ExportResult>;
  removeBackups(ids: string[]): Promise<void>;
}
export interface SpeechApi {
  get(): Promise<SpeechView>;
  save(draft: SpeechDraft, apiKey?: string): Promise<SpeechView>;
  beginCapture(sessionId: string): Promise<{ operationId: string }>;
  submit(audio: AudioSubmission): Promise<{ operationId: string; text: string }>;
  cancel(operationId: string): Promise<void>;
}
export interface SandboxApi { detect(): Promise<SandboxAvailability>; prepareImage(): Promise<{ imageId: string }>; timing(runId:string,callId:string):Promise<{elapsedMs:number;active:boolean}>;onImageProgress(listener:(text:string)=>void):()=>void }
