import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, expect, test } from "vitest";
import { namespaceA as n, namespaceB } from "../../../tests/fixtures/data";
import { fileFixture } from "./file-feature-fixture";
import { AttachmentService } from "../src/main/files/attachment-service";
import { ContextAssembler } from "../src/main/files/context-assembler";
const cleanup:(()=>Promise<void>)[]=[];afterEach(async()=>{for(const f of cleanup.splice(0))await f();});
const posix=test.skipIf(process.platform==="win32");
async function setup() {const x=await fileFixture();cleanup.push(x.cleanup);return {...x,attachments:new AttachmentService(x.store,x.artifacts,x.files,x.grants,()=>n,()=>7),assembler:new ContextAssembler(x.store,x.artifacts)};}
posix("sends complete Chinese excerpts and honestly describes binary files, not private host paths",async()=>{
  const x=await setup(),paths=[join(x.source,"large.txt"),join(x.source,"report.pdf")];await writeFile(paths[0],"中".repeat(22000));await writeFile(paths[1],"%PDF-1.7\nnot extracted");
  const a=await x.attachments.importPicked(n,x.session.id,x.grants.issue(n,x.session.id,7,paths),new AbortController().signal);
  const profile={...x.provider,contextWindow:200000,maxOutputTokens:100};
  const messages=await x.assembler.assembleContext(n,x.session.id,"",a.map(v=>v.id),profile,[]),text=messages.at(-1)!.content;
  expect(text).toContain("已添加文件");expect(text).toContain("中".repeat(21845));expect(text).not.toContain("�");expect(text).toContain("摘录已截断");expect(text).toContain("未提取正文");expect(text).not.toContain("not extracted");expect(text).not.toContain(x.root);
  x.store.runs.createWithUserMessage(n,x.session.id,"",{attachmentIds:a.map(v=>v.id)});
  const again=await x.assembler.assembleContext(n,x.session.id,"继续",[],profile,[]);expect(again[0].content).toContain("中".repeat(100));expect(again.at(-1)!.content).toBe("继续");
});
posix("invalid/repeated/foreign IDs and oversized history refuse before committing",async()=>{
  const x=await setup(),p=join(x.source,"note.txt");await writeFile(p,"secret");const [a]=await x.attachments.importPicked(n,x.session.id,x.grants.issue(n,x.session.id,7,[p]),new AbortController().signal);
  await expect(x.assembler.assembleContext(n,x.session.id,"hi",[a.id,a.id],x.provider,[])).rejects.toMatchObject({code:"INVALID_INPUT"});
  await expect(x.assembler.assembleContext(namespaceB,x.session.id,"hi",[a.id],x.provider,[])).rejects.toMatchObject({code:"NOT_FOUND"});
  await expect(x.assembler.assembleContext(n,x.session.id,"中".repeat(1000),[],{...x.provider,contextWindow:2048,maxOutputTokens:16},[])).rejects.toMatchObject({code:"CONTEXT_TOO_LARGE"});
  expect(x.store.sessions.messages(n,x.session.id)).toEqual([]);
});
