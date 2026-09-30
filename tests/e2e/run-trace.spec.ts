import { test, expect } from "@playwright/test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { launch } from "./helpers";
import { startFixtureModelServer } from "../fixtures/openai-server";
import { validDraft } from "../fixtures/data";
test("per-run traces retain explanations, public reasoning, elapsed time and two model changes",async({},info)=>{
  const directory=mkdtempSync(join(tmpdir(),"fastgpt-trace-")),server=await startFixtureModelServer(),app=await launch(directory);
  try {
    const page=await app.firstWindow();await page.waitForFunction(()=>!!window.desktop);
    const ids=await page.evaluate(async draft=>{
      const first=await window.desktop.providers.save({...draft,name:"模型 A",modelId:"model-A",capabilities:{...draft.capabilities,reasoningField:"reasoning_content"}},"TRACE_SECRET");
      const second=await window.desktop.providers.save({...draft,name:"模型 B",modelId:"model-B",capabilities:{...draft.capabilities,reasoningField:"reasoning_content"}},"TRACE_SECRET");
      const session=await window.desktop.sessions.create({title:"执行轨迹",providerId:first.id});return {first:first.id,second:second.id,session:session.id};
    },{...validDraft,baseUrl:server.baseUrl,allowInsecureHttp:true});
    await page.reload();await page.locator('.recent-row').click();await expect(page.getByLabel("当前模型")).toHaveValue(ids.first);
    await page.getByRole("textbox",{name:"消息"}).fill("时间轨迹");await page.getByRole("button",{name:"发送",exact:true}).click();
    await expect(page.getByText("工具前解释",{exact:true})).toBeVisible();await expect(page.getByLabel("当前模型")).toBeDisabled();
    await expect(page.getByTestId("run-status")).toHaveText("已完成");
    await page.locator(".trace-reasoning > summary").click();await expect(page.locator(".trace-reasoning pre")).toContainText("服务公开内容");
    await expect(page.locator(".message.assistant").filter({hasText:"工具前解释"})).toHaveCount(1);
    const frozen=await page.getByTestId("run-elapsed").last().textContent();
    await page.waitForTimeout(1100);await expect(page.getByTestId("run-elapsed").last()).toHaveText(frozen!);
    await page.getByLabel("当前模型").selectOption(ids.second);await expect(page.getByLabel("当前模型")).toBeEnabled();
    await page.getByRole("textbox",{name:"消息"}).fill("第二次");await page.getByRole("button",{name:"发送",exact:true}).click();await expect(page.locator(".run-trace")).toHaveCount(2);await expect(page.getByTestId("run-status")).toHaveText("已完成");
    await expect(page.locator(".run-trace").last()).toContainText("模型 B · model-B");
    await page.getByLabel("当前模型").selectOption(ids.first);await expect(page.getByLabel("当前模型")).toBeEnabled();
    await page.getByRole("textbox",{name:"消息"}).fill("第三次");await page.getByRole("button",{name:"发送",exact:true}).click();
    await expect(page.locator(".run-trace")).toHaveCount(3);await expect(page.getByTestId("run-status")).toHaveText("已完成");
    const snapshots=await page.evaluate(async id=>(await window.desktop.runs.list(id)).map(r=>r.modelSnapshot?.modelId),ids.session);
    expect(snapshots).toEqual(["model-A","model-B","model-A"]);
    expect(server.requests.filter(r=>r.stream).map(r=>r.model)).toEqual(["model-A","model-A","model-B","model-A"]);
    expect(server.requests.every(r=>!JSON.stringify(r.messages).includes("服务公开内容"))).toBe(true);
    await expect(page.locator(".message.user").last()).toContainText("第三次");await expect(page.getByRole("textbox",{name:"消息"})).toBeEnabled();await page.locator(".run-trace").last().scrollIntoViewIfNeeded();
    await expect(page.locator(".message-avatar")).toHaveCount(0);expect((await page.locator(".run-trace").allTextContents()).join("\n")).not.toContain("TRACE_SECRET");
    await page.screenshot({path:info.outputPath("run-trace.png")});
  } finally {await app.close();await server.close();rmSync(directory,{recursive:true,force:true});}
});
