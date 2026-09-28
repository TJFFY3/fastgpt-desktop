import { expect, test } from "vitest";
import { AgentRunner } from "../src/runner";
import type { AgentEvent, ModelRequest, RunInput } from "../../shared/src/index";
import { fakeModelProfile, namespaceA } from "../../../tests/fixtures/data";
test("context budget blocks an oversized Chinese request before any model call",async()=>{
  const events:AgentEvent[]=[],requests:ModelRequest[]=[];
  const input:RunInput={runId:"r",sessionId:"s",namespace:namespaceA,profile:{...fakeModelProfile,contextWindow:2048,maxOutputTokens:16},messages:[{role:"user",content:"中".repeat(600)}],tools:[]};
  await new AgentRunner({model:{probe:async()=>({reachable:true,tools:false}),async *stream(request){requests.push(request);yield {type:"text_delta",text:"done"};yield {type:"finish",reason:"stop"};}},executor:{execute:async()=>({content:"unused",isError:false})},onEvent:async e=>{events.push(e);}}).run(input,"fixture",new AbortController().signal);
  expect(requests).toHaveLength(0);expect(events).toContainEqual(expect.objectContaining({type:"error",code:"CONTEXT_TOO_LARGE"}));
});
test("later tool rounds recheck full paired history instead of silently truncating it",async()=>{
  const events:AgentEvent[]=[],requests:ModelRequest[]=[];
  const input:RunInput={runId:"r",sessionId:"s",namespace:namespaceA,profile:{...fakeModelProfile,contextWindow:4096,maxOutputTokens:16},messages:[{role:"user",content:"hi"}],tools:[{name:"read",description:"read",parameters:{type:"object",properties:{},additionalProperties:false}}]};
  await new AgentRunner({model:{probe:async()=>({reachable:true,tools:true}),async *stream(request){requests.push(request);if(requests.length===1){yield {type:"tool_call_delta",index:0,id:"c",name:"read",argumentsDelta:"{}"};yield {type:"finish",reason:"tool_calls"};}else{yield {type:"finish",reason:"stop"};}}},executor:{execute:async()=>({content:"中".repeat(1000),isError:false})},onEvent:async e=>{events.push(e);}}).run(input,"fixture",new AbortController().signal);
  expect(requests).toHaveLength(1);expect(events).toContainEqual(expect.objectContaining({type:"error",code:"CONTEXT_TOO_LARGE"}));
});
