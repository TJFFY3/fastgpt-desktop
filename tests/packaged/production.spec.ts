import {test,expect,_electron} from "@playwright/test";
import {mkdtempSync,writeFileSync,readFileSync,existsSync,realpathSync,rmSync} from "node:fs";
import {join,resolve} from "node:path";
import {tmpdir} from "node:os";
import {validDraft} from "../fixtures/data";

test("production package uses isolated native profile, bundled safe helper/assets, and ignores test environment overrides",async({},info)=>{
 const profile=realpathSync(mkdtempSync(join(tmpdir(),"fastgpt-package-profile-"))),ignored=mkdtempSync(join(tmpdir(),"fastgpt-package-ignored-")),source=mkdtempSync(join(tmpdir(),"fastgpt-package-source-"));
 writeFileSync(join(source,"note.txt"),"packaged native bytes");
 // Electron v44.4.5 maps this native switch to app.getPath(userData) before JS.
 // Never rely on the intentionally inert TEST_DATA_DIR to protect a real profile.
 const binary=process.env.FASTGPT_PACKAGED_EXECUTABLE??resolve(`release/mac-${process.arch}/FastGPT Desktop.app/Contents/MacOS/FastGPT Desktop`);
 const app=await _electron.launch({executablePath:binary,args:[`--user-data-dir=${profile}`],env:{...process.env,FASTGPT_DESKTOP_TEST_DATA_DIR:ignored,FASTGPT_DESKTOP_TEST_FAKE_AUDIO:"1",FASTGPT_DESKTOP_TEST_START_DELAY_MS:"2000",ELECTRON_RENDERER_URL:"http://127.0.0.1:1"}});
 try{
  const page=await app.firstWindow();await page.waitForFunction(()=>!!window.desktop);
  const state=await app.evaluate(({app})=>({packaged:app.isPackaged,userData:app.getPath("userData"),appPath:app.getAppPath(),fake:app.commandLine.hasSwitch("use-fake-device-for-media-stream"),resources:process.resourcesPath}));
  expect(state.packaged).toBe(true);expect(state.userData).toBe(profile);expect(state.appPath).toContain("app.asar");expect(state.fake).toBe(false);expect(page.url()).toBe("app://desktop/index.html");
  expect(existsSync(join(profile,"fastgpt.sqlite"))).toBe(true);expect(existsSync(join(ignored,"fastgpt.sqlite"))).toBe(false);
  for(const asset of ["Dockerfile","runner.py","transfer.py",".dockerignore"])expect(existsSync(join(state.resources,"sandbox-image",asset))).toBe(true);
  expect(existsSync(join(state.resources,"safe-files","safe-files"))).toBe(true);
  const provider=await page.evaluate(d=>window.desktop.providers.save(d),validDraft);
  const session=await page.evaluate(id=>window.desktop.sessions.create({title:"生产包验收",providerId:id}),provider.id);
  await app.evaluate(({dialog},p)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[p]});},source);
  const preview=await page.evaluate(id=>window.desktop.workspaces.previewSelection(id),session.id);
  expect(preview.entryCount).toBe(1);await page.evaluate(({sid,g})=>window.desktop.workspaces.importSelection(sid,g),{sid:session.id,g:preview.grantId});
  expect(await page.evaluate(id=>window.desktop.workspaces.read(id,"note.txt",0,100),session.id)).toMatchObject({text:"packaged native bytes"});expect(readFileSync(join(source,"note.txt"),"utf8")).toBe("packaged native bytes");
  await page.reload();await page.getByRole("button",{name:"工作区",exact:true}).click();await expect(page.getByTestId("workspace-files")).toContainText("note.txt");await page.screenshot({path:info.outputPath("production-package.png")});
 }finally{await app.close();rmSync(profile,{recursive:true,force:true});rmSync(ignored,{recursive:true,force:true});rmSync(source,{recursive:true,force:true});}
});
