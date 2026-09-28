import { mkdtemp, mkdir, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { openStore } from "../../../packages/storage/src/index";
import { namespaceA as n, validDraft } from "../../../tests/fixtures/data";
import { SafeFileOps } from "../src/main/files/safe-file-ops";
import { ArtifactStore } from "../src/main/files/artifact-store";
import { InputGrants } from "../src/main/files/input-grants";
export async function fileFixture() {
  const root=await realpath(await mkdtemp(join(tmpdir(),"fastgpt-feature-"))),source=join(root,"source");await mkdir(source);
  const store=openStore(join(root,"test.sqlite")),provider=store.providers.save(n,validDraft,null),session=store.sessions.create(n,{title:"files",providerId:provider.id});
  const files=new SafeFileOps(resolve("apps/desktop/native-build/safe-files")),artifacts=new ArtifactStore(join(root,"artifacts"),files),grants=new InputGrants();
  return {root,source,store,provider,session,files,artifacts,grants,cleanup:async()=>{store.close();await rm(root,{recursive:true,force:true});}};
}
