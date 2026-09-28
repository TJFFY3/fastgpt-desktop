import { join } from "node:path";
import type { Namespace } from "../../../../packages/shared/src/index";
import type { Store } from "../../../../packages/storage/src/index";
import { SafeFileOps } from "./files/safe-file-ops";
import { ArtifactStore } from "./files/artifact-store";
import { InputGrants } from "./files/input-grants";
import { WorkspaceSnapshots } from "./files/workspace-snapshots";
import { AttachmentService } from "./files/attachment-service";
import { ContextAssembler } from "./files/context-assembler";
import { WorkspaceService } from "./workspaces/workspace-service";
export function createFeatureServices(options:{store:Store;dataDirectory:string;helperPath:string;principal:()=>Namespace;window:()=>number;pickWorkspace:()=>Promise<string|null>}) {
  const files=new SafeFileOps(options.helperPath),artifacts=new ArtifactStore(join(options.dataDirectory,"artifacts"),files),grants=new InputGrants();
  const snapshots=new WorkspaceSnapshots(options.store,artifacts,options.principal),attachments=new AttachmentService(options.store,artifacts,files,grants,options.principal,options.window,snapshots),context=new ContextAssembler(options.store,artifacts);
  const workspaces=new WorkspaceService({...options,files,artifacts,grants,snapshots,pick:options.pickWorkspace,credentialRoots:[options.dataDirectory]});
  return {files,artifacts,grants,snapshots,attachments,context,workspaces};
}
