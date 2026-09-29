import { test, expect } from "vitest";
import { engineFixture } from "./fixture";
test("explicitly prepares only the trusted test image",async()=>{const {client,images}=engineFixture();await client.assertLocal();if(await images.getReadyImage())return;const result=await images.prepare(new AbortController().signal,text=>process.stderr.write(text));expect(result.imageId).toMatch(/^sha256:[a-f0-9]{64}$/);expect(await images.getReadyImage()).toBe(result.imageId);},600000);
