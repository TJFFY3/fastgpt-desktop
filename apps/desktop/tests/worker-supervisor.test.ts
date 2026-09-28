import { EventEmitter } from "node:events";
import { expect, it, vi } from "vitest";
import { WorkerSupervisor } from "../src/main/worker-supervisor";
import { fakeModelProfile, namespaceA } from "../../../tests/fixtures/data";
import type {
  RunInput,
  WorkerCommand,
} from "../../../packages/shared/src/index";
class Child extends EventEmitter {
  sent: WorkerCommand[] = [];
  killed = false;
  postMessage(c: WorkerCommand) {
    this.sent.push(c);
  }
  kill() {
    this.killed = true;
    this.emit("exit", 0);
    return true;
  }
}
const input: RunInput = {
  runId: "run",
  sessionId: "s",
  namespace: namespaceA,
  profile: fakeModelProfile,
  messages: [],
  tools: [],
};
it("waits for event persistence before acknowledging and rejects unbound run IDs", async () => {
  const child = new Child(),
    worker = new WorkerSupervisor(() => child);
  let resolve!: () => void;
  const persisted = new Promise<void>((r) => {
    resolve = r;
  });
  let exits = 0;
  worker.start(
    input,
    "key",
    () => persisted,
    async () => ({ content: "", isError: false }),
    async () => {
      exits++;
    },
  );
  child.emit("message", { type: "ready" });
  expect(child.sent[0].type).toBe("start");
  child.emit("message", {
    type: "event",
    runId: "run",
    requestId: "ack",
    event: { type: "text_delta", text: "hi" },
  });
  await Promise.resolve();
  expect(child.sent).toHaveLength(1);
  resolve();
  await vi.waitFor(() => expect(child.sent.at(-1)?.type).toBe("event_ack"));
  child.emit("message", {
    type: "event",
    runId: "other",
    requestId: "bad",
    event: { type: "text_delta", text: "bad" },
  });
  await vi.waitFor(() => expect(exits).toBe(1));
  expect(child.killed).toBe(true);
});
it("aborts first and force-stops an unresponsive worker after two seconds", async () => {
  vi.useFakeTimers();
  try {
    const child = new Child(),
      worker = new WorkerSupervisor(() => child);
    worker.start(
      input,
      "key",
      async () => {},
      async () => ({ content: "", isError: false }),
      async () => {},
    );
    worker.cancel("run");
    expect(child.sent[0]).toEqual({ type: "cancel", runId: "run" });
    expect(child.killed).toBe(false);
    await vi.advanceTimersByTimeAsync(2000);
    expect(child.killed).toBe(true);
  } finally {
    vi.useRealTimers();
  }
});
it("worker exit aborts approval/tool waits before draining the persistence queue",async()=>{
  const child=new Child(),worker=new WorkerSupervisor(()=>child);let release!:(r:{content:string;isError:boolean})=>void,aborted=false,exits=0;const pending=new Promise<{content:string;isError:boolean}>(r=>{release=r;});
  worker.start(input,"key",async()=>{},()=>pending,async()=>{exits++;},()=>{aborted=true;release({content:"cancelled",isError:true});});
  child.emit("message",{type:"tool_request",runId:"run",requestId:"tool",call:{id:"call",name:"workspace_exec",arguments:"{}"}});await Promise.resolve();child.emit("exit",1);
  await vi.waitFor(()=>expect(exits).toBe(1));expect(aborted).toBe(true);await worker.shutdown();
});
it("exit cannot wait indefinitely for a tool promise that ignores cancellation",async()=>{
  const child=new Child(),worker=new WorkerSupervisor(()=>child);let exits=0;
  worker.start(input,"key",async()=>{},()=>new Promise(()=>{}),async()=>{exits++;});
  child.emit("message",{type:"tool_request",runId:"run",requestId:"tool",call:{id:"call",name:"workspace_exec",arguments:"{}"}});await Promise.resolve();child.emit("exit",1);await vi.waitFor(()=>expect(exits).toBe(1));await worker.shutdown();
});
it("tools queued before exit but not yet started never execute after exit",async()=>{const child=new Child(),worker=new WorkerSupervisor(()=>child);let starts=0,exits=0;worker.start(input,"key",async()=>{},async()=>{starts++;return {content:"",isError:false};},async()=>{exits++;});child.emit("message",{type:"tool_request",runId:"run",requestId:"tool",call:{id:"call",name:"workspace_exec",arguments:"{}"}});child.emit("exit",1);await vi.waitFor(()=>expect(exits).toBe(1));expect(starts).toBe(0);});
