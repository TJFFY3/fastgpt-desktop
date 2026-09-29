import {test,expect} from "@playwright/test";
import {mkdtempSync,writeFileSync,readFileSync,readdirSync,rmSync} from "node:fs";
import {join} from "node:path";
import {tmpdir} from "node:os";
import {launch,configure,latestStatus} from "./helpers";
import {syntheticAudioDevice,audioTracksEnded} from "./audio-fixture";
import {startModelServer,chatChunk,writeStream} from "../fixtures/openai-server";
import {startTranscriptionServer} from "../fixtures/transcription-server";
import {validDraft} from "../fixtures/data";

// The model/ASR transport and native dialogs are controlled boundaries. Docker,
// snapshots, SQLite, helper, worker, MediaRecorder and the rendered UI are real.
test("model switch, attachment, public reasoning, real command, conflict, backup, restart and ASR remain scoped and plain text",async({},info)=>{
 const profile=mkdtempSync(join(tmpdir(),"fastgpt-joint-")),source=mkdtempSync(join(tmpdir(),"fastgpt-joint-source-"));
 const html='<img src=x onerror="window.unsafeHtml=true">',attachment=join(source,"context.txt");
 writeFileSync(attachment,"ATTACHMENT_CONTEXT");writeFileSync(join(source,"note.txt"),"original");
 const server=await startModelServer((body,res,req)=>{
  if(req.url!=="/chat/completions"){res.writeHead(404,{"Content-Type":"text/html"});res.end("wrong endpoint");return;}
  writeStream(res,body.messages?.at(-1)?.role==="user"?[
   chatChunk({reasoning_content:html}),chatChunk({tool_calls:[{index:0,id:"joint-command",type:"function",function:{name:"workspace_exec",arguments:JSON.stringify({command:`printf '%s\\n' '${html}'; sleep 2; printf 'changed' > note.txt`,cwd:"."})}}]}),chatChunk({},"tool_calls")
  ]:[chatChunk({content:html}),chatChunk({},"stop")]);
 });
 const asr=await startTranscriptionServer(res=>{res.setHeader("Content-Type","application/json");res.end(JSON.stringify({text:html}));});
 let app=await launch(profile,{FASTGPT_DESKTOP_TEST_FAKE_AUDIO:"1"});
 try{
  const configured=await configure(app,server.baseUrl);let page=configured.page;const sid=configured.session.id;
  const rootUrl=new URL(server.baseUrl).origin;
  const alternate=await page.evaluate(d=>window.desktop.providers.save(d,"MODEL_KEY_SENTINEL"),{...validDraft,name:"联合模型",baseUrl:rootUrl,allowInsecureHttp:true,capabilities:{...validDraft.capabilities,reasoningField:"reasoning_content" as const}});
  await app.evaluate(({dialog},p)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[p]});dialog.showMessageBox=async()=>({response:0,checkboxChecked:false});},source);
  const preview=await page.evaluate(id=>window.desktop.workspaces.previewSelection(id),sid);
  await page.evaluate(({sid,g})=>window.desktop.workspaces.importSelection(sid,g),{sid,g:preview.grantId});
  await app.evaluate(({dialog},p)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[p]});},attachment);
  await page.evaluate(id=>window.desktop.attachments.pick(id),sid);await page.reload();
  await page.getByRole("combobox",{name:"当前模型"}).selectOption(alternate.id);
  await expect.poll(()=>page.evaluate(async id=>(await window.desktop.sessions.list()).find(s=>s.id===id)?.providerId,sid)).toBe(alternate.id);
  await expect(page.locator(".composer")).toContainText("context.txt");
  await page.getByTestId("sandbox-state").click();await page.getByRole("button",{name:"准备沙箱",exact:true}).click();await expect(page.getByTestId("sandbox-state")).toContainText("已就绪",{timeout:20000});
  await page.getByRole("textbox",{name:"消息",exact:true}).fill("联合执行");await page.getByRole("button",{name:"发送",exact:true}).click();
  const approval=page.locator(".trace-approval[data-state=pending]");await expect(approval).toContainText(rootUrl);
  await approval.getByRole("button",{name:"批准本次"}).click();await expect(page.getByTestId("command-output")).toContainText(html);await expect(page.getByTestId("command-elapsed")).toContainText("执行中");
  await expect.poll(()=>latestStatus(page,sid)).toBe("completed");await expect(page.locator(".trace-reasoning")).toContainText(html);
  expect(JSON.stringify(server.requests)).toContain("ATTACHMENT_CONTEXT");expect(readFileSync(join(source,"note.txt"),"utf8")).toBe("original");
  expect(await page.locator(".messages img,.run-trace img").count()).toBe(0);expect(await page.evaluate(()=>(window as unknown as {unsafeHtml?:boolean}).unsafeHtml)).toBeUndefined();
  const workspace=await page.evaluate(id=>window.desktop.workspaces.list(id),sid);expect(workspace.entries.map(e=>e.relativePath)).toContain("note.txt");
  const conflictPreview=await page.evaluate(id=>window.desktop.exports.preview(id,["note.txt"]),sid);writeFileSync(join(source,"note.txt"),"external edit");
  const conflict=await page.evaluate(token=>window.desktop.exports.apply(token,[{path:"note.txt",action:"write"}]),conflictPreview.token);expect(conflict[0].status).toBe("conflict");expect(readFileSync(join(source,"note.txt"),"utf8")).toBe("external edit");
  writeFileSync(join(source,"note.txt"),"original");const safePreview=await page.evaluate(id=>window.desktop.exports.preview(id,["note.txt"]),sid);
  const result=await page.evaluate(token=>window.desktop.exports.apply(token,[{path:"note.txt",action:"write"}]),safePreview.token);expect(result[0].status).toBe("written");expect(readFileSync(join(source,"note.txt"),"utf8")).toBe("changed");
  expect(await page.locator(".run-trace").textContent()).not.toContain("MODEL_KEY_SENTINEL");for(const f of readdirSync(profile).filter(f=>f.startsWith("fastgpt.sqlite")))expect(readFileSync(join(profile,f)).includes(Buffer.from("MODEL_KEY_SENTINEL"))).toBe(false);
  await app.close();app=await launch(profile,{FASTGPT_DESKTOP_TEST_FAKE_AUDIO:"1"});page=await app.firstWindow();await page.waitForFunction(()=>!!window.desktop);
  expect(await page.evaluate(id=>window.desktop.workspaces.list(id),sid)).toEqual(workspace);expect((await page.evaluate(()=>window.desktop.exports.listBackups())).some(b=>b.id===result[0].backupId)).toBe(true);
  // Test builds deliberately keep keys only in process memory; restart must not
  // silently recover one or replay a run. Re-enter only the fixture key.
  await page.evaluate(({id,draft})=>window.desktop.providers.save(draft,"MODEL_KEY_SENTINEL",id),{id:alternate.id,draft:{...validDraft,name:alternate.name,baseUrl:alternate.baseUrl,allowInsecureHttp:true}});
  await page.evaluate(baseUrl=>window.desktop.speech.save({enabled:true,name:"Independent ASR",baseUrl,modelId:"asr",timeoutMs:10000,allowInsecureHttp:true},"ASR_KEY_SENTINEL"),asr.baseUrl);
  await syntheticAudioDevice(page);await page.reload();const count=server.requests.length;
  await page.getByRole("textbox",{name:"消息",exact:true}).fill("preserved draft");await page.getByRole("button",{name:"开始录音",exact:true}).click();await expect(page.getByTestId("voice-state")).toContainText("录音中");await page.waitForTimeout(350);await page.getByRole("button",{name:"停止并转写",exact:true}).click();await expect(page.getByTestId("voice-transcript")).toHaveValue(html);expect(await audioTracksEnded(page)).toBe(true);
  await page.getByRole("button",{name:"插入草稿",exact:true}).click();await expect(page.getByRole("textbox",{name:"消息",exact:true})).toHaveValue("preserved draft\n"+html);expect(server.requests).toHaveLength(count);expect(await page.locator(".composer img").count()).toBe(0);
  await page.screenshot({path:info.outputPath("joint-safety.png")});
 }finally{await app.close();await server.close();await asr.close();rmSync(profile,{recursive:true,force:true});rmSync(source,{recursive:true,force:true});}
});
