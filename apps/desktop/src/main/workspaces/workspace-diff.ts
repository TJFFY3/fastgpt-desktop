import type { FileEntry, WorkspaceDiff } from "../../../../../packages/shared/src/index";
export async function workspaceDiff(before:FileEntry[],after:FileEntry[],binary:(path:string,key:"before"|"after")=>Promise<boolean>):Promise<WorkspaceDiff[]> {
  const a=new Map(before.map(e=>[e.relativePath,e])),b=new Map(after.map(e=>[e.relativePath,e])),result:WorkspaceDiff[]=[];
  for(const path of [...new Set([...a.keys(),...b.keys()])].sort()) {const old=a.get(path),next=b.get(path);if(old&&next&&old.kind===next.kind&&old.sha256===next.sha256)continue;
    const hasFile=next?.kind==="file"?next:old?.kind==="file"?old:null;result.push({relativePath:path,kind:!old?"added":!next?"deleted":"modified",beforeHash:old?.sha256??null,afterHash:next?.sha256??null,binary:hasFile?await binary(path,next?.kind==="file"?"after":"before"):false});
  }return result;
}
