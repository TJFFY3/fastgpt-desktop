import { join } from "node:path";
import type { AgentEvent, Namespace, ToolContext } from "../../../../packages/shared/src/index";
import type { Store } from "../../../../packages/storage/src/index";
import { SafeFileOps } from "./files/safe-file-ops";
import { ArtifactStore } from "./files/artifact-store";
import { InputGrants } from "./files/input-grants";
import { WorkspaceSnapshots } from "./files/workspace-snapshots";
import { AttachmentService } from "./files/attachment-service";
import { ContextAssembler } from "./files/context-assembler";
import { WorkspaceService } from "./workspaces/workspace-service";
import { ExportService, type ExportOptions } from "./workspaces/export-service";
import { ApprovalService } from "./tools/approval-service";
import { DockerClient, DockerSandboxProvider, ImageService } from "../../../../packages/sandbox/src/index";
export type ImagePreparation={controller:AbortController|null;promise:Promise<unknown>|null};
export function createFeatureServices(options:{store:Store;dataDirectory:string;helperPath:string;principal:()=>Namespace;window:()=>number;pickWorkspace:()=>Promise<string|null>;confirmExport:ExportOptions["confirm"];dockerExecutable:string;imageDirectory:string;persistEvent:(context:ToolContext,event:AgentEvent)=>Promise<void>}) {
  const files=new SafeFileOps(options.helperPath),artifacts=new ArtifactStore(join(options.dataDirectory,"artifacts"),files),grants=new InputGrants();
  const snapshots=new WorkspaceSnapshots(options.store,artifacts,options.principal),attachments=new AttachmentService(options.store,artifacts,files,grants,options.principal,options.window,snapshots),context=new ContextAssembler(options.store,artifacts);
  const workspaces=new WorkspaceService({...options,files,artifacts,grants,snapshots,pick:options.pickWorkspace,credentialRoots:[options.dataDirectory]});
  const approvals=new ApprovalService(options),client=new DockerClient(options.dockerExecutable),images=new ImageService({client,assetDirectory:options.imageDirectory,stateDirectory:join(options.dataDirectory,"sandbox/image")}),sandbox=new DockerSandboxProvider({client,images,files:artifacts,stateDirectory:join(options.dataDirectory,"sandbox/owners")});const imagePreparation:ImagePreparation={controller:null,promise:null};
  const exports=new ExportService({workspace:workspaces,directory:join(options.dataDirectory,"backups"),principal:options.principal,pickDirectory:options.pickWorkspace,confirm:options.confirmExport,credentialRoots:[options.dataDirectory]});
  return {files,artifacts,grants,snapshots,attachments,context,workspaces,exports,approvals,sandbox,imagePreparation};
}
