import { afterEach, expect, test } from "vitest";
import { AgentService, type Supervisor } from "../src/main/agent-service";
import { ProviderService } from "../src/main/provider-service";
import { SecretStore } from "../src/main/credentials";
import { createBuiltinTools } from "../src/main/tool-gateway";
import { RunStartService } from "../src/main/run-start-service";
import { openStore } from "../../../packages/storage/src/index";
import type { RunInput, Namespace } from "../../../packages/shared/src/index";
import { namespaceA as n, namespaceB, validDraft } from "../../../tests/fixtures/data";

const cleanups:(()=>void)[]=[];afterEach(()=>cleanups.splice(0).reverse().forEach(fn=>fn()));
async function setup(delayed=false, tools=true) {
  const store=openStore(":memory:");cleanups.push(()=>store.close());
  let release:(value:string)=>void=()=>{},entered:()=>void=()=>{};
  const decrypting=new Promise<void>(r=>entered=r),key=new Promise<string>(r=>release=r);
  const providers=new ProviderService(store.providers,new SecretStore(store.credentials,{
    isAvailable:async()=>true,isSecure:async()=>true,encrypt:async()=>new Uint8Array([1,2,3]),
    decrypt:async()=>{entered();return delayed?key:"KEY_SENTINEL";},
  }));
  const p=await providers.save(n,{...validDraft,capabilities:{...validDraft.capabilities,tools}},"KEY_SENTINEL");
  const s=store.sessions.create(n,{title:"run",providerId:p.id});
  const inputs:RunInput[]=[];const supervisor:Supervisor={start(input){inputs.push(input);},cancel(){},shutdown:async()=>{}};
  let principal:Namespace=n;
  const service=new AgentService(store,providers,supervisor,createBuiltinTools(),()=>principal,()=>{});
  return {store,providers,p,s,inputs,service,decrypting,release:()=>release("KEY_SENTINEL"),switchIdentity:()=>principal=namespaceB};
}
test.each(["switch","edit"])("%s while decrypting refuses stale startup without saving a message",async(mode)=>{
  const x=await setup(true),starting=x.service.start(n,x.s.id,"hello");
  const result=starting.then(()=>null,e=>e);await x.decrypting;
  if(mode==="switch") {
    const b=x.store.providers.save(n,{...validDraft,modelId:"model-B"},null);
    x.store.sessions.update(n,x.s.id,{providerId:b.id});
  } else x.store.providers.save(n,{...validDraft,modelId:"model-edited"},x.p.credentialState==="missing"?null:x.store.providers.get(n,x.p.id).credentialRef,x.p.id);
  x.release(); expect(await result).toMatchObject({code:"CONFIG_CHANGED"});
  expect(x.store.sessions.messages(n,x.s.id)).toEqual([]);expect(x.inputs).toEqual([]);
});
test("each run pins its non-secret model configuration and disables unsupported tools",async()=>{
  const x=await setup(false,false),run=await x.service.start(n,x.s.id,"hello");
  expect(run.modelSnapshot).toMatchObject({providerId:x.p.id,modelId:"test-model",revision:x.p.revision});
  expect(JSON.stringify(run)).not.toContain("KEY_SENTINEL");expect(JSON.stringify(run.modelSnapshot)).not.toContain("credentialRef");
  expect(x.inputs[0].tools).toEqual([]);expect(x.store.sessions.messages(n,x.s.id)[0].runId).toBe(run.id);
});
test("identity changes during secret resolution never start a worker",async()=>{
  const x=await setup(true),result=x.service.start(n,x.s.id,"hello").catch(e=>e);
  await x.decrypting;x.switchIdentity();x.release();
  expect(await result).toMatchObject({code:"PERMISSION_DENIED"});expect(x.inputs).toEqual([]);
});
test("context preparation and final commit both recheck workspace and session revisions",async()=>{
  const x=await setup();
  let release:()=>void=()=>{},entered:()=>void=()=>{};
  const awaitingContext=new Promise<void>(r=>entered=r),hold=new Promise<void>(r=>release=r);
  const starter=new RunStartService(x.store,x.providers,()=>n,()=>[],async()=>{entered();await hold;return [{role:"user",content:"hello"}];});
  const pending=starter.prepare(n,{sessionId:x.s.id,text:"hello",attachmentIds:[]}).catch(e=>e);
  await awaitingContext;x.store.sessions.update(n,x.s.id,{title:"updated"});release();
  expect(await pending).toMatchObject({code:"CONFIG_CHANGED"});expect(x.store.runs.list(n,x.s.id)).toEqual([]);
  const ready=await new RunStartService(x.store,x.providers,()=>n,()=>[]).prepare(n,{sessionId:x.s.id,text:"hello",attachmentIds:[]});
  x.store.sessions.update(n,x.s.id,{title:"changed again"});
  expect(()=>ready.commit()).toThrow(expect.objectContaining({code:"CONFIG_CHANGED"}));expect(x.store.sessions.messages(n,x.s.id)).toEqual([]);
});
