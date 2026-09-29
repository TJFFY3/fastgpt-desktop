import { afterEach, expect, test, vi } from "vitest";
import { AgentService, type Supervisor } from "../src/main/agent-service";
import { ProviderService } from "../src/main/provider-service";
import { SecretStore } from "../src/main/credentials";
import { createBuiltinTools } from "../src/main/tool-gateway";
import { openStore } from "../../../packages/storage/src/index";
import type { AgentEvent, RunTimingSnapshot } from "../../../packages/shared/src/index";
import { namespaceA as n, namespaceB as foreign, validDraft } from "../../../tests/fixtures/data";
afterEach(()=>{vi.useRealTimers();vi.unstubAllGlobals();});
test("total timing includes waiting, ignores wall-clock rollback, persists and freezes at terminal",async()=>{
  vi.useFakeTimers();let monotonic=100;
  vi.stubGlobal("performance",{now:()=>monotonic});
  const store=openStore(":memory:");
  const providers=new ProviderService(store.providers,new SecretStore(store.credentials,{isAvailable:async()=>false,isSecure:async()=>false,encrypt:async()=>new Uint8Array(),decrypt:async()=>""}));
  let event:(e:AgentEvent)=>Promise<void>=async()=>{};
  const supervisor:Supervisor={start(_input,_key,onEvent){event=onEvent;},cancel(){},shutdown:async()=>{}};
  const service=new AgentService(store,providers,supervisor,createBuiltinTools(),()=>n,()=>{});
  const measured=service;
  try {
    const p=await providers.save(n,validDraft,"key"),s=store.sessions.create(n,{title:"timer",providerId:p.id}),r=await service.start(n,s.id,"hi");
    monotonic+=5000;vi.setSystemTime(1700000000000);vi.advanceTimersByTime(5000);
    expect(measured.timing?.(n,r.id).elapsedMs ?? store.runs.get(n,r.id).elapsedMs).toBe(5000);
    expect(store.runs.get(n,r.id).elapsedMs).toBe(5000);
    await event({type:"status",status:"running"});await event({type:"status",status:"waiting_approval"});
    monotonic+=2000;await service.cancel(n,r.id);await event({type:"status",status:"cancelled"});
    monotonic+=9000;
    expect(measured.timing(n,r.id)).toEqual({runId:r.id,elapsedMs:7000,active:false});
    expect(()=>measured.timing(foreign,r.id)).toThrow(/NOT_FOUND/);
    await event({type:"status",status:"completed"});expect(measured.timing(n,r.id).elapsedMs).toBe(7000);
  } finally {measured.dispose?.();store.close();}
});
