import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";
import { ChatView } from "../src/renderer/components/ChatView";
import type { AgentEvent, MessageRecord, RunEvent, RunRecord } from "../../../packages/shared/src/index";
import { RunTrace } from "../src/renderer/components/RunTrace";
const message:MessageRecord={id:"user",sessionId:"s",runId:"r",attachmentIds:[],seq:1,role:"user",content:"hi",status:"complete",createdAt:1};
const event=(value:AgentEvent,seq:number):RunEvent=>({...value,runId:"r",sessionId:"s",seq,createdAt:seq});
const committed:RunEvent={...event({type:"assistant_message",message:{role:"assistant",content:"工具前解释"}},1),messageId:"assistant"};
function render(messages:MessageRecord[],events:RunEvent[]) {return renderToStaticMarkup(createElement(ChatView,{messages,events,hasSession:true,hasModels:true,onSettings(){}}));}
test("a committed intermediate reply stays visible during the following tool request",()=>{
  const html=render([message],[committed,event({type:"tool_started",call:{id:"c",name:"get_current_time",arguments:"{}"}},2)]);
  expect(html).toContain("工具前解释");
});
test("message IDs reconcile committed history with live events without repeating content",()=>{
  const assistant:MessageRecord={...message,id:"assistant",seq:2,role:"assistant",content:"工具前解释"};
  const html=render([message,assistant],[committed]);expect(html.split("工具前解释")).toHaveLength(2);
});
test("trace renders untrusted output as text and never marks unfinished tools successful",()=>{
  const run:RunRecord={id:"r",sessionId:"s",status:"interrupted",errorCode:null,createdAt:1,updatedAt:2,modelSnapshot:null,elapsedMs:65000,timingUpdatedAt:2};
  const html=renderToStaticMarkup(createElement(RunTrace,{run,latest:true,events:[event({type:"tool_started",call:{id:"c",name:"workspace_exec",arguments:'{"command":"<script>bad()</script>"}'},},1),event({type:"reasoning_delta",text:"服务返回的公开内容"},2)]}));
  expect(html).toContain("已中断 / 结果未知");expect(html).toContain("总耗时 1 分 5 秒");expect(html).toContain("模型公开思考（服务返回）");expect(html).toContain("&lt;script&gt;");expect(html).not.toContain("<script>");
});
