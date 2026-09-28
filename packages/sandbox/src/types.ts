import type { AgentEvent, CommandFinishReason, SandboxAvailability } from "../../shared/src/index";
export type SandboxExecution={owner:{namespaceKey:string;sessionId:string;runId:string;callId:string};snapshotKey:string;command:string;cwd:string;signal:AbortSignal;onEvent:(event:AgentEvent)=>Promise<void>};
export type SandboxResult={exitCode:number|null;reason:CommandFinishReason;elapsedMs:number;truncated:boolean;snapshotKey:string|null};
export interface SandboxProvider {detect():Promise<SandboxAvailability>;prepareImage(signal:AbortSignal,onProgress:(text:string)=>void):Promise<{imageId:string}>;execute(input:SandboxExecution):Promise<SandboxResult>;cancel(runId:string):Promise<void>;cleanupOwned():Promise<void>;shutdown():Promise<void>;}
