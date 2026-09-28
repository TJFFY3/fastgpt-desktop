import { expect, test } from "vitest";
import { ExecutionQueue } from "../src/execution-queue";
const gate=()=>{let resolve:()=>void=()=>{};return {promise:new Promise<void>(r=>resolve=r),release:()=>resolve()};};
test("real queue runs at most two operations and admits waiting work in FIFO order",async()=>{
  const queue=new ExecutionQueue(),gates=[gate(),gate(),gate(),gate()],order:number[]=[];let active=0,max=0;
  const jobs=gates.map((g,i)=>queue.run(new AbortController().signal,async()=>{order.push(i);max=Math.max(max,++active);await g.promise;active--;return i;}));
  jobs.forEach(p=>void p.catch(()=>{}));
  await Promise.resolve();await Promise.resolve();expect(order).toEqual([0,1]);gates[1].release();expect(await jobs[1]).toBe(1);await Promise.resolve();expect(order).toEqual([0,1,2]);gates[0].release();expect(await jobs[0]).toBe(0);await Promise.resolve();expect(order).toEqual([0,1,2,3]);gates[2].release();gates[3].release();expect(await Promise.all(jobs)).toEqual([0,1,2,3]);expect(max).toBe(2);
});
test("queued cancellation and shutdown never invoke the waiting command",async()=>{
  const queue=new ExecutionQueue(),hold=gate();const jobs=[0,1].map(()=>queue.run(new AbortController().signal,()=>hold.promise));jobs.forEach(p=>void p.catch(()=>{}));await Promise.resolve();await Promise.resolve();
  let starts=0;const abort=new AbortController(),pending=queue.run(abort.signal,async()=>{starts++;});abort.abort();await expect(pending).rejects.toMatchObject({code:"CANCELLED"});
  const more=queue.run(new AbortController().signal,async()=>{starts++;});queue.close();await expect(more).rejects.toMatchObject({code:"CANCELLED"});hold.release();await Promise.all(jobs);expect(starts).toBe(0);
});
