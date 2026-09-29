import { expect, test } from "vitest";
import { z } from "zod";
import * as shared from "../src/index";
import { fakeModelProfile } from "../../../tests/fixtures/data";

const exports = shared as unknown as Record<string, z.ZodType>;
test("legacy model defaults explicitly disable reasoning rather than accepting an implicit field", () => {
  const { reasoningField: _ignored, ...oldCapabilities } = fakeModelProfile.capabilities as typeof fakeModelProfile.capabilities & {reasoningField?: string};
  expect(shared.modelProfileSchema.parse({...fakeModelProfile, capabilities: oldCapabilities}).capabilities)
    .toMatchObject({ reasoningField: "none" });
});

test("attachment-only starts are valid, but empty starts and duplicate IDs are refused", () => {
  const schema = exports.runStartSchema ?? shared.sendMessageSchema;
  expect(schema.safeParse({ sessionId: "s", text: "", attachmentIds: ["a"] }).success).toBe(true);
  expect(schema.safeParse({ sessionId: "s", text: "", attachmentIds: [] }).success).toBe(false);
  expect(schema.safeParse({ sessionId: "s", text: "hi", attachmentIds: ["a", "a"] }).success).toBe(false);
  expect(schema.safeParse({ sessionId: "s", text: "中".repeat(21846), attachmentIds: [] }).success).toBe(false);
  expect(schema.safeParse({sessionId:"s",text:"hi",attachmentIds:[],namespace:{accountId:"other"}}).success).toBe(false);
});

test("public reasoning is accepted, while Worker-supplied ownership is rejected", () => {
  expect(shared.agentEventSchema.safeParse({type:"reasoning_delta",text:"公开内容"}).success).toBe(true);
  expect(shared.agentEventSchema.safeParse({type:"assistant_message",message:{role:"assistant",content:"ok"},messageId:"forged"}).success).toBe(false);
  expect(shared.agentEventSchema.safeParse({type:"command_finished",id:"c",exitCode:0,elapsedMs:-1,reason:"exited",truncated:false}).success).toBe(false);
});

test("audio submission bounds actual bytes and only accepts supported MIME types", () => {
  const parse = (bytes:Uint8Array,mimeType="audio/webm") => exports.audioSubmissionSchema?.safeParse({sessionId:"s",operationId:"o",mimeType,bytes}).success ?? false;
  expect(parse(new Uint8Array([0x1a,0x45,0xdf,0xa3]))).toBe(true);
  expect(parse(new Uint8Array(20*1024*1024+1))).toBe(false);
  expect(parse(new Uint8Array())).toBe(false);
  expect(parse(new Uint8Array([1]),"video/mp4")).toBe(false);
});

test("model snapshots cannot contain a credential reference or raw key", () => {
  const schema = exports.modelSnapshotSchema;
  const value={providerId:"p",revision:"v",name:"model",baseUrl:"https://example.com/v1",modelId:"m",capabilities:{tools:false,temperature:false,outputTokenField:"max_tokens",reasoningField:"none"},contextWindow:32768,maxOutputTokens:4096,timeoutMs:120000};
  expect(schema?.safeParse(value).success ?? false).toBe(true);
  expect(schema?.safeParse({...value,credentialRef:"secret-ref"}).success ?? false).toBe(false);
  expect(schema?.safeParse({...value,apiKey:"secret"}).success ?? false).toBe(false);
});
