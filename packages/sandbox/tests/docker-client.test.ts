import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test } from "vitest";
import { DockerClient } from "../src/docker-client";
const dirs:string[]=[];afterEach(async()=>{for(const dir of dirs.splice(0))await rm(dir,{recursive:true,force:true});});
test.skipIf(process.platform==="win32")("real CLI process preserves literal arguments and strips ambient secrets/host overrides",async()=>{
  const root=await mkdtemp(join(tmpdir(),"fastgpt-cli-"));dirs.push(root);const cli=join(root,"fake docker"),config=join(root,"config");await mkdir(config);
  await writeFile(cli,`#!${process.execPath}\nconst args=process.argv.slice(2);if(args[0]==='context'&&args[1]==='show')process.stdout.write('desktop-linux');else if(args[0]==='context')process.stdout.write(JSON.stringify([{Endpoints:{docker:{Host:'unix:///var/run/docker.sock'}}}]));else process.stdout.write(JSON.stringify({args,secret:process.env.FASTGPT_TEST_SECRET,env:Object.keys(process.env)}));\n`,{mode:0o700});
  const previous=process.env.FASTGPT_TEST_SECRET;process.env.FASTGPT_TEST_SECRET="DO_NOT_FORWARD";
  try {const client=new DockerClient(cli,{configurationDirectory:config,host:"",context:""}),result=await client.run(["echo-test","literal;not-a-shell","$(not-a-shell)"]),value=JSON.parse(result.stdout);expect(value.args).toEqual(["--context","desktop-linux","echo-test","literal;not-a-shell","$(not-a-shell)"]);expect(value.secret).toBeUndefined();expect(value.env).not.toContain("FASTGPT_TEST_SECRET");}
  finally{if(previous===undefined)delete process.env.FASTGPT_TEST_SECRET;else process.env.FASTGPT_TEST_SECRET=previous;}
  await expect(new DockerClient(cli,{configurationDirectory:config,host:"tcp://remote:2375"}).run(["info"])).rejects.toMatchObject({code:"DOCKER_REMOTE"});
});
