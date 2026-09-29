import { afterEach, expect, test } from "vitest";
import { OpenAiChatAdapter } from "../src/index";
import { chatChunk, startModelServer, writeStream } from "../../../tests/fixtures/openai-server";
import { fakeModelProfile } from "../../../tests/fixtures/data";
import type { ModelEvent } from "../../shared/src/index";
const servers:Awaited<ReturnType<typeof startModelServer>>[]=[];
afterEach(async()=>{await Promise.all(servers.splice(0).map(s=>s.close()));});
async function collect(handler:Parameters<typeof startModelServer>[0],enabled=true) {
  const server=await startModelServer(handler);servers.push(server);
  const events:ModelEvent[]=[];
  for await(const event of new OpenAiChatAdapter().stream({profile:{...fakeModelProfile,baseUrl:server.baseUrl,allowInsecureHttp:true,capabilities:{...fakeModelProfile.capabilities,reasoningField:enabled?"reasoning_content":"none"}},apiKey:"fixture",messages:[{role:"user",content:"hello"}],tools:[],signal:new AbortController().signal})) events.push(event);
  return {events,requests:server.requests};
}
test.each(["SSE","JSON"])("%s reads public reasoning separately from the answer",async(format)=>{
  const {events,requests}=await collect((_body,res)=>{
    if(format==="SSE") writeStream(res,[chatChunk({reasoning_content:"服务公开内容"}),chatChunk({content:"完成"}),chatChunk({},"stop")]);
    else {res.setHeader("Content-Type","application/json");res.end(JSON.stringify({choices:[{message:{content:"完成",reasoning_content:"服务公开内容"},finish_reason:"stop"}]}));}
  });
  expect(events.filter(e=>e.type==="reasoning_delta")).toEqual([{type:"reasoning_delta",text:"服务公开内容"}]);
  expect(events.filter(e=>e.type==="text_delta")).toEqual([{type:"text_delta",text:"完成"}]);
  expect(JSON.stringify(requests)).not.toContain("reasoning_content");
});
test("disabled reasoning ignores provider-specific data without weakening answer validation",async()=>{
  const {events}=await collect((_b,res)=>writeStream(res,[chatChunk({reasoning_content:{private:"ignore"},content:"answer"}),chatChunk({},"stop")]),false);
  expect(events).toEqual([{type:"text_delta",text:"answer"},{type:"finish",reason:"stop"}]);
});
test("enabled malformed reasoning and reasoning after finish are protocol errors",async()=>{
  await expect(collect((_b,res)=>writeStream(res,[chatChunk({reasoning_content:123}),chatChunk({},"stop")]))).rejects.toMatchObject({code:"MODEL_PROTOCOL_ERROR"});
  await expect(collect((_b,res)=>writeStream(res,[chatChunk({content:"answer"}),chatChunk({},"stop"),chatChunk({reasoning_content:"late"})]))).rejects.toMatchObject({code:"MODEL_PROTOCOL_ERROR"});
});
test("UTF-8 split inside a Chinese character keeps public content intact",async()=>{
  const {events}=await collect((_b,res)=>{
    res.writeHead(200,{"Content-Type":"text/event-stream"});
    const bytes=Buffer.from(`data: ${JSON.stringify(chatChunk({reasoning_content:"中文"}))}\n\ndata: ${JSON.stringify(chatChunk({},"stop"))}\n\ndata: [DONE]\n\n`);
    const split=bytes.indexOf(Buffer.from("中"))+1;res.write(bytes.subarray(0,split));res.end(bytes.subarray(split));
  });
  expect(events[0]).toEqual({type:"reasoning_delta",text:"中文"});
});
