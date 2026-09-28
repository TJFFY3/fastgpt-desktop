import { test,expect } from "@playwright/test";
import { mkdtempSync,writeFileSync,rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { launch,configure } from "./helpers";
import { startFixtureModelServer } from "../fixtures/openai-server";
test("accepted messages and attachments are not offered for retry when a follow-up read fails",async()=>{
 const directory=mkdtempSync(join(tmpdir(),"fastgpt-accepted-")),source=mkdtempSync(join(tmpdir(),"fastgpt-accepted-file-")),file=join(source,"note.txt");writeFileSync(file,"file content");const server=await startFixtureModelServer(),app=await launch(directory);
 try{const {page,session}=await configure(app,server.baseUrl);await app.evaluate(({dialog},path)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[path]});},file);await page.evaluate(id=>window.desktop.attachments.pick(id),session.id);await page.reload();await expect(page.locator(".composer")).toContainText("note.txt");await app.evaluate(({ipcMain})=>{ipcMain.removeHandler("attachments:list");ipcMain.handle("attachments:list",()=>({ok:false,error:{code:"READ_UNAVAILABLE",message:"后续读取不可用"}}));});await page.getByRole("textbox",{name:"消息",exact:true}).fill("唯一发送");await page.getByRole("button",{name:"发送",exact:true}).click();await expect(page.getByRole("alert").first()).toContainText("消息已发送");await expect(page.getByRole("textbox",{name:"消息",exact:true})).toHaveValue("");await expect(page.locator(".composer")).not.toContainText("note.txt");await expect.poll(()=>page.evaluate(async id=>(await window.desktop.runs.list(id)).at(-1)?.status,session.id)).toBe("completed");expect((await page.evaluate(id=>window.desktop.sessions.messages(id),session.id)).filter(m=>m.role==="user")).toHaveLength(1);
 }finally{await app.close();await server.close();rmSync(directory,{recursive:true,force:true});rmSync(source,{recursive:true,force:true});}
});
