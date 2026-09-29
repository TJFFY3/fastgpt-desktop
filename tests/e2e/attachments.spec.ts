import { test, expect } from "@playwright/test";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { launch, configure } from "./helpers";
import { startFixtureModelServer } from "../fixtures/openai-server";
test("real picker and disk-backed drop create bounded copies; file-only sends and history survive restart",async({},info)=>{
  const directory=mkdtempSync(join(tmpdir(),"fastgpt-attachments-")),source=mkdtempSync(join(tmpdir(),"fastgpt-input-")),note=join(source,"note.txt"),pdf=join(source,"report.pdf");writeFileSync(note,"真实附件文本");writeFileSync(pdf,"%PDF-1.7\nunextracted");
  const server=await startFixtureModelServer();let app=await launch(directory);
  try {
    const {page}=await configure(app,server.baseUrl);await page.reload();
    await app.evaluate(({dialog},path)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[path]});dialog.showMessageBox=async()=>({response:1,checkboxChecked:false});},note);
    await page.getByRole("button",{name:"添加文件",exact:true}).click();await expect(page.locator(".composer .attachment-card")).toContainText("note.txt");
    await page.getByRole("button",{name:"移除 note.txt"}).click();await expect(page.locator(".composer .attachment-card")).toHaveCount(0);
    await page.getByRole("button",{name:"添加文件",exact:true}).click();await expect(page.locator(".composer .attachment-card")).toHaveCount(1);
    await page.evaluate(()=>{const input=document.createElement("input");input.type="file";input.id="disk-file-test";input.multiple=true;document.body.append(input);});
    await page.locator("#disk-file-test").setInputFiles(pdf);
    await page.evaluate(()=>{const input=document.querySelector<HTMLInputElement>("#disk-file-test")!,transfer=new DataTransfer();for(const file of input.files!)transfer.items.add(file);document.querySelector(".composer")!.dispatchEvent(new DragEvent("drop",{bubbles:true,dataTransfer:transfer}));input.remove();});
    await expect(page.locator(".composer .attachment-card")).toHaveCount(2);await expect(page.locator(".composer")).toContainText("未提取正文");
    await expect(page.locator(".composer")).toContainText(server.baseUrl);writeFileSync(note,"原文件后续改动");
    await page.getByRole("button",{name:"发送",exact:true}).click();await expect(page.getByTestId("run-status")).toHaveText("已完成");
    await expect(page.locator(".message.user .attachment-card")).toHaveCount(2);await expect(page.locator(".composer .attachment-card")).toHaveCount(0);
    const request=JSON.stringify(server.requests[0].messages);expect(request).toContain("真实附件文本");expect(request).not.toContain("原文件后续改动");expect(request).toContain("未提取正文");expect(request).not.toContain("unextracted");expect(request).not.toContain(source);
    await expect(page.evaluate(async()=>{try{await window.desktop.attachments.importDropped((await window.desktop.sessions.list())[0].id,[new File(["fake"],"fake.txt")]);return true;}catch{return false;}})).resolves.toBe(false);
    await page.screenshot({path:info.outputPath("attachments.png")});await app.close();app=await launch(directory);const restored=await app.firstWindow();
    await expect(restored.locator(".message.user .attachment-card")).toHaveCount(2);await expect(restored.locator(".message.user")).toContainText("report.pdf");
  } finally {await app.close();await server.close();rmSync(directory,{recursive:true,force:true});rmSync(source,{recursive:true,force:true});}
});
