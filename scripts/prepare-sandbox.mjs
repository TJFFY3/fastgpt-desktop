import { spawn } from "node:child_process";
const child=spawn(process.execPath,["node_modules/vitest/vitest.mjs","run","--config","vitest.sandbox.config.ts"],{stdio:"inherit",env:{...process.env,FASTGPT_PREPARE_SANDBOX:"1"},shell:false});
child.once("error",error=>{process.stderr.write(`${error.message}\n`);process.exitCode=1;});child.once("exit",code=>{process.exitCode=code??1;});
