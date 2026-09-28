import { test, expect } from "@playwright/test";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { launch, configure } from "./helpers";
import { startFixtureModelServer } from "../fixtures/openai-server";
test("native directory preview imports only after confirmation and keeps source paths private",async()=>{
  const directory=mkdtempSync(join(tmpdir(),"fastgpt-workspace-")),source=mkdtempSync(join(tmpdir(),"fastgpt-directory-"));mkdirSync(join(source,"empty"));mkdirSync(join(source,".git"));writeFileSync(join(source,".env"),"SECRET_FILE");writeFileSync(join(source,"note.txt"),"中文");
  const server=await startFixtureModelServer(),app=await launch(directory);
  try {const {page,session}=await configure(app,server.baseUrl);await app.evaluate(({dialog},path)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[path]});},source);
    const preview=await page.evaluate(id=>window.desktop.workspaces.previewSelection(id),session.id);expect(preview.entryCount).toBe(2);expect(preview.excluded).toEqual([".env",".git"]);
    expect((await page.evaluate(id=>window.desktop.sessions.list().then(s=>s.find(v=>v.id===id)),session.id))!.workspaceId).toBeNull();expect(server.requests).toEqual([]);
    const view=await page.evaluate(({id,grant})=>window.desktop.workspaces.importSelection(id,grant),{id:session.id,grant:preview.grantId});expect(view).not.toHaveProperty("sourceRoot");expect(view).not.toHaveProperty("snapshotKey");
    writeFileSync(join(source,"note.txt"),"外部修改");const read=await page.evaluate(id=>window.desktop.workspaces.read(id,"note.txt",0,4),session.id);expect(read).toMatchObject({text:"中",nextOffset:3,remainingBytes:3});expect(readFileSync(join(source,"note.txt"),"utf8")).toBe("外部修改");
    const listing=await page.evaluate(id=>window.desktop.workspaces.list(id),session.id);expect(listing.entries.map(e=>e.relativePath)).toEqual(["empty","note.txt"]);expect(JSON.stringify({preview,view,listing,read})).not.toContain(source);
    expect(await page.evaluate(async id=>{try{await window.desktop.workspaces.read(id,"../outside",0,64);return "allowed";}catch(e){return String(e);}},session.id)).toContain("UNSAFE_PATH");
    expect(await page.evaluate(async id=>{try{await window.desktop.workspaces.previewSelection(id);return "allowed";}catch(e){return String(e);}},session.id)).toContain("WORKSPACE_BOUND");
  }finally{await app.close();await server.close();rmSync(directory,{recursive:true,force:true});rmSync(source,{recursive:true,force:true});}
});
