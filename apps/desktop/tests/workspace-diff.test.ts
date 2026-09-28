import { expect, test } from "vitest";
import type { FileEntry } from "../../../packages/shared/src/index";
import { workspaceDiff } from "../src/main/workspaces/workspace-diff";
const file=(relativePath:string,sha256:string):FileEntry=>({relativePath,kind:"file",size:3,sha256}),directory=(relativePath:string):FileEntry=>({relativePath,kind:"directory",size:0,sha256:null});
test("hash/type diffs retain binary changes and empty-directory changes in stable order",async()=>{
  const before=[file("same","1".repeat(64)),file("changed","2".repeat(64)),file("deleted","3".repeat(64)),file("type","4".repeat(64)),directory("empty")];
  const after=[file("same","1".repeat(64)),file("changed","5".repeat(64)),file("new.pdf","6".repeat(64)),directory("type"),directory("new-empty")];
  const calls:string[]=[],changes=await workspaceDiff(before,after,async(path,version)=>{calls.push(`${version}:${path}`);return path.endsWith(".pdf");});
  expect(changes.map(c=>[c.relativePath,c.kind,c.binary])).toEqual([["changed","modified",false],["deleted","deleted",false],["empty","deleted",false],["new-empty","added",false],["new.pdf","added",true],["type","modified",false]]);
  expect(calls).toEqual(["after:changed","before:deleted","after:new.pdf","before:type"]);expect(changes[0]).toMatchObject({beforeHash:"2".repeat(64),afterHash:"5".repeat(64)});
});
