import { defineConfig } from "vitest/config";
export default defineConfig({test:{include:[process.env.FASTGPT_PREPARE_SANDBOX==="1"?"packages/sandbox/tests-integration/prepare.integration.ts":"packages/sandbox/tests-integration/docker.integration.ts"],fileParallelism:false,testTimeout:180000,hookTimeout:600000}});
