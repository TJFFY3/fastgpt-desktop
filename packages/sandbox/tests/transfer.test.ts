import { afterEach, expect, test } from "vitest";
import { createHash } from "node:crypto";
import { readdir, writeFile, readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileFixture } from "../../../apps/desktop/tests/file-feature-fixture";
import { receiveTransfer, encodeTransfer } from "../src/transfer";
const cleanup:(()=>Promise<void>)[]=[];afterEach(async()=>{for(const fn of cleanup.splice(0))await fn();});
const posix=test.skipIf(process.platform==="win32");
function frame(header:unknown){const bytes=Buffer.from(JSON.stringify(header)),size=Buffer.alloc(4);size.writeUInt32BE(bytes.length);return Buffer.concat([size,bytes]);}
async function* stream(...parts:Uint8Array[]){for(const p of parts)for(let i=0;i<p.length;i+=7)yield p.subarray(i,i+7);}
posix("bounded length-prefixed transport preserves actual bytes, hashes and empty directories",async()=>{
  const x=await fileFixture();cleanup.push(x.cleanup);const data=Buffer.from("中文"),header={type:"entry",entry:{relativePath:"empty/note.txt",kind:"file",size:data.length,sha256:createHash("sha256").update(data).digest("hex")}};
  const key=await receiveTransfer(stream(frame({type:"entry",entry:{relativePath:"empty",kind:"directory",size:0,sha256:null}}),frame(header),data,frame({type:"end"})),x.artifacts,new AbortController().signal);
  const chunks:Uint8Array[]=[];for await(const c of x.artifacts.read(key,"empty/note.txt"))chunks.push(c);expect(Buffer.concat(chunks).toString()).toBe("中文");
  const encoded:Uint8Array[]=[];for await(const c of encodeTransfer(key,x.artifacts,new AbortController().signal))encoded.push(c);const copy=await receiveTransfer(stream(...encoded),x.artifacts,new AbortController().signal);expect(await x.artifacts.manifest(copy)).toEqual(await x.artifacts.manifest(key));
});
posix("malicious paths, hashes, duplicated names, huge headers and incomplete/trailing streams never return snapshots",async()=>{
  const x=await fileFixture();cleanup.push(x.cleanup);const entry={relativePath:"note",kind:"file",size:3,sha256:"0".repeat(64)},tooLong=Buffer.alloc(4);tooLong.writeUInt32BE(4097);
  await writeFile(join(x.root,"outside"),"UNCHANGED");
  for(const parts of [[frame({type:"entry",entry:{...entry,relativePath:"../outside"}})],[frame({type:"entry",entry}),Buffer.from("abc"),frame({type:"end"})],[tooLong],[frame({type:"entry",entry:{...entry,size:100*1024*1024+1}})],[frame({type:"end"}),Buffer.from([1])],[frame({type:"entry",entry:{relativePath:"dir",kind:"directory",size:0,sha256:null}}),frame({type:"entry",entry:{relativePath:"dir",kind:"directory",size:0,sha256:null}}),frame({type:"end"})]])await expect(receiveTransfer(stream(...parts),x.artifacts,new AbortController().signal)).rejects.toBeDefined();
  expect(await readFile(join(x.root,"outside"),"utf8")).toBe("UNCHANGED");expect(await readdir(join(x.root,"artifacts",".owners"))).toEqual([]);
});
posix("cancelled stalled input stops promptly and releases the owned receiving snapshot",async()=>{
  const x=await fileFixture();cleanup.push(x.cleanup);const abort=new AbortController(),input:AsyncIterable<Uint8Array>={[Symbol.asyncIterator]:()=>({next:()=>new Promise(()=>{}),return:async()=>({done:true,value:undefined})})};
  const receiving=receiveTransfer(input,x.artifacts,abort.signal);const timer=setTimeout(()=>abort.abort(),20);try{await expect(receiving).rejects.toMatchObject({code:"CANCELLED"});}finally{clearTimeout(timer);}expect(await readdir(join(x.root,"artifacts",".owners"))).toEqual([]);
});
