import { expect, it } from "vitest";
import { AgentService, modelHistory } from "../src/main/agent-service";
import { ToolGateway, createBuiltinTools } from "../src/main/tool-gateway";
import { openStore } from "../../../packages/storage/src/index";
import { ProviderService } from "../src/main/provider-service";
import { SecretStore } from "../src/main/credentials";
import type {
  AgentEvent,
  RunInput,
  ToolCall,
  ToolResult,
} from "../../../packages/shared/src/index";
import {
  namespaceA,
  namespaceB,
  validDraft,
} from "../../../tests/fixtures/data";
function setup() {
  const store = openStore(":memory:");
  const providers = new ProviderService(
    store.providers,
    new SecretStore(store.credentials, {
      isAvailable: async () => false,
      isSecure: async () => false,
      encrypt: async () => new Uint8Array(),
      decrypt: async () => "",
    }),
  );
  const workers = new Map<
    string,
    {
      input: RunInput;
      event: (e: AgentEvent) => Promise<void>;
      tool: (c: ToolCall) => Promise<ToolResult>;
      exit: () => Promise<void>;
      stopping?:()=>void;
    }
  >();
  const supervisor = {
    start: (
      input: RunInput,
      _key: string,
      event: (e: AgentEvent) => Promise<void>,
      tool: (c: ToolCall) => Promise<ToolResult>,
      exit: () => Promise<void>,
      stopping?:()=>void,
    ) => {
      workers.set(input.runId, { input, event, tool, exit,stopping });
    },
    cancel: () => {},
    shutdown: async () => {},
  };
  const notifications: AgentEvent[] = [];
  return {
    store,
    providers,
    workers,
    service: new AgentService(
      store,
      providers,
      supervisor,
      createBuiltinTools(),
      () => namespaceA,
      (e) => notifications.push(e),
    ),
    notifications,
  };
}
it("main tool events use the same persist-before-publish path and reject foreign/terminal contexts",async()=>{const s=setup();try{const p=await s.providers.save(namespaceA,validDraft,"key"),session=s.store.sessions.create(namespaceA,{title:"main events",providerId:p.id}),run=await s.service.start(namespaceA,session.id,"hi"),context={namespace:namespaceA,sessionId:session.id,runId:run.id};await s.workers.get(run.id)!.event({type:"status",status:"running"});await s.service.emit(context,{type:"command_started",id:"call",command:"echo safe",cwd:"."});expect(s.store.runs.events(namespaceA,run.id).at(-1)?.type).toBe("command_started");expect(s.notifications.at(-1)?.type).toBe("command_started");await expect(s.service.emit({...context,namespace:namespaceB},{type:"status",status:"running"})).rejects.toThrow();await s.workers.get(run.id)!.event({type:"status",status:"completed"});await expect(s.service.emit(context,{type:"command_output",id:"call",channel:"stdout",text:"late"})).rejects.toMatchObject({code:"PERMISSION_DENIED"});}finally{s.service.dispose();s.store.close();}});
it("main cancellation cleanup is persisted while cancelling, without accepting late output or success",async()=>{const s=setup();try{const p=await s.providers.save(namespaceA,validDraft,"key"),session=s.store.sessions.create(namespaceA,{title:"cleanup",providerId:p.id}),run=await s.service.start(namespaceA,session.id,"hi"),context={namespace:namespaceA,sessionId:session.id,runId:run.id};await s.workers.get(run.id)!.event({type:"status",status:"running"});await s.service.cancel(namespaceA,run.id);await s.service.emit(context,{type:"command_finished",id:"call",exitCode:null,elapsedMs:123,reason:"cancelled",truncated:false});expect(s.store.runs.events(namespaceA,run.id).at(-1)?.type).toBe("command_finished");await expect(s.service.emit(context,{type:"workspace_checkpoint",id:"late",workspaceId:"late",revision:4})).rejects.toMatchObject({code:"PERMISSION_DENIED"});}finally{s.service.dispose();s.store.close();}});
it("abort-before-drain on an unexpected worker exit remains interrupted rather than a user cancellation",async()=>{const s=setup();try{const p=await s.providers.save(namespaceA,validDraft,"key"),session=s.store.sessions.create(namespaceA,{title:"crash",providerId:p.id}),run=await s.service.start(namespaceA,session.id,"hi"),worker=s.workers.get(run.id)!;await worker.event({type:"status",status:"running"});worker.stopping?.();await worker.exit();expect(s.store.runs.get(namespaceA,run.id).status).toBe("interrupted");}finally{s.service.dispose();s.store.close();}});
it("starts atomically, denies another identity and persists before publishing", async () => {
  const s = setup();
  try {
    const p = await s.providers.save(namespaceA, validDraft, "key"),
      session = s.store.sessions.create(namespaceA, {
        title: "test",
        providerId: p.id,
      });
    const run = await s.service.start(namespaceA, session.id, "hello");
    await expect(
      s.service.start(namespaceA, session.id, "again"),
    ).rejects.toThrow(/RUN_ACTIVE/);
    await expect(s.service.cancel(namespaceB, run.id)).rejects.toThrow(
      /NOT_FOUND/,
    );
    const worker = s.workers.get(run.id)!;
    await worker.event({ type: "status", status: "running" });
    await worker.event({ type: "text_delta", text: "partial" });
    await worker.exit();
    expect(s.store.runs.get(namespaceA, run.id).status).toBe("interrupted");
    expect(
      s.store.sessions.messages(namespaceA, session.id).at(-1),
    ).toMatchObject({ content: "partial", status: "interrupted" });
    expect(s.notifications).toHaveLength(
      s.store.runs.events(namespaceA, run.id).length,
    );
  } finally {
    s.store.close();
  }
});
it("executes a call once and refuses unresolved or changed duplicate calls", async () => {
  const s = setup();
  try {
    const p = await s.providers.save(namespaceA, validDraft, "key"),
      session = s.store.sessions.create(namespaceA, {
        title: "test",
        providerId: p.id,
      }),
      r = s.store.runs.createWithUserMessage(namespaceA, session.id, "hi"),
      gateway = new ToolGateway(s.store.runs, createBuiltinTools());
    const ctx = { namespace: namespaceA, sessionId: session.id, runId: r.id },
      call = { id: "c", name: "get_current_time", arguments: "{}" },
      signal = new AbortController().signal;
    expect(await gateway.execute(call, ctx, signal)).toEqual(
      await gateway.execute(call, ctx, signal),
    );
    await expect(
      gateway.execute(
        { ...call, arguments: '{"timezone":"UTC"}' },
        ctx,
        signal,
      ),
    ).rejects.toThrow(/MODEL_PROTOCOL_ERROR/);
    s.store.runs.reserveToolCall(namespaceA, r.id, {
      ...call,
      id: "unresolved",
    });
    await expect(
      gateway.execute({ ...call, id: "unresolved" }, ctx, signal),
    ).rejects.toThrow(/TOOL_UNRESOLVED/);
    await expect(
      gateway.execute(
        { ...call, id: "invalid", arguments: '{"timezone":"invalid/zone"}' },
        ctx,
        signal,
      ),
    ).rejects.toThrow(/INVALID_INPUT/);
  } finally {
    s.store.close();
  }
});
it("drops incomplete tool groups and partial messages from model history", () => {
  const records = [
    { role: "user", content: "hi", status: "complete" },
    {
      role: "assistant",
      content: null,
      status: "complete",
      toolCalls: [{ id: "c", name: "time", arguments: "{}" }],
    },
    { role: "assistant", content: "partial", status: "partial" },
  ];
  expect(modelHistory(records as Parameters<typeof modelHistory>[0])).toEqual([
    { role: "user", content: "hi" },
  ]);
});
it("cancels and suppresses late text while permitting a new run after the terminal event", async () => {
  const s = setup();
  try {
    const p = await s.providers.save(namespaceA, validDraft, "key"),
      session = s.store.sessions.create(namespaceA, {
        title: "test",
        providerId: p.id,
      }),
      r = await s.service.start(namespaceA, session.id, "hello"),
      w = s.workers.get(r.id)!;
    await w.event({ type: "status", status: "running" });
    await w.event({ type: "text_delta", text: "keep" });
    await s.service.cancel(namespaceA, r.id);
    await w.event({ type: "text_delta", text: "discard" });
    await w.event({ type: "status", status: "cancelled" });
    expect(
      s.store.sessions.messages(namespaceA, session.id).at(-1),
    ).toMatchObject({ content: "keep", status: "partial" });
    expect(s.store.runs.get(namespaceA, r.id).status).toBe("cancelled");
    expect(
      (await s.service.start(namespaceA, session.id, "again")).status,
    ).toBe("queued");
  } finally {
    s.store.close();
  }
});
