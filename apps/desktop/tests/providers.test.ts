import { expect, it } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SecretStore } from "../src/main/credentials";
import { ProviderService } from "../src/main/provider-service";
import { openStore } from "../../../packages/storage/src/index";
import {
  namespaceA,
  namespaceB,
  validDraft,
} from "../../../tests/fixtures/data";
const backend = {
  isAvailable: async () => false,
  isSecure: async () => false,
  encrypt: async () => new Uint8Array(),
  decrypt: async () => "",
};
it("preserves a key when editing and returns only safe model metadata", async () => {
  const store = openStore(":memory:");
  const secrets = new SecretStore(store.credentials, backend);
  const service = new ProviderService(store.providers, secrets);
  try {
    const saved = await service.save(namespaceA, validDraft, "secret-for-test");
    const edited = await service.save(
      namespaceA,
      { ...validDraft, name: "renamed" },
      undefined,
      saved.id,
    );
    expect(edited.name).toBe("renamed");
    expect(edited.credentialState).toBe("session_only");
    expect((await service.resolve(namespaceA, saved.id)).apiKey).toBe(
      "secret-for-test",
    );
    expect(JSON.stringify(await service.list(namespaceA))).not.toContain(
      "secret-for-test",
    );
    expect(edited).not.toHaveProperty("credentialRef");
    await expect(service.resolve(namespaceB, saved.id)).rejects.toThrow(
      /NOT_FOUND/,
    );
    const originalRef = store.providers.get(
      namespaceA,
      saved.id,
    ).credentialRef!;
    await service.save(namespaceA, validDraft, "new-secret", saved.id);
    expect(await secrets.get(originalRef, namespaceA)).toBeNull();
  } finally {
    store.close();
  }
});
it("does not remove the credential if removing a referenced provider fails", async () => {
  const store = openStore(":memory:");
  const secrets = new SecretStore(store.credentials, backend);
  const service = new ProviderService(store.providers, secrets);
  try {
    const saved = await service.save(namespaceA, validDraft, "key");
    store.sessions.create(namespaceA, { title: "chat", providerId: saved.id });
    await expect(service.remove(namespaceA, saved.id)).rejects.toThrow(
      /INVALID_INPUT/,
    );
    expect((await service.resolve(namespaceA, saved.id)).apiKey).toBe("key");
    secrets.clearSessionOnly();
    expect((await service.list(namespaceA))[0].credentialState).toBe("missing");
    await expect(service.resolve(namespaceA, saved.id)).rejects.toThrow(
      /CREDENTIAL_REQUIRED/,
    );
  } finally {
    store.close();
  }
});
it("rolls back a new credential when a real SQLite profile update fails", async () => {
  const dir = mkdtempSync(join(tmpdir(), "fastgpt-provider-")),
    path = join(dir, "test.sqlite"),
    store = openStore(path),
    db = new DatabaseSync(path);
  const secrets = new SecretStore(store.credentials, {
      isAvailable: async () => true,
      isSecure: async () => true,
      encrypt: async (value) => Buffer.from([...value].reverse().join("")),
      decrypt: async (value) =>
        [...Buffer.from(value).toString()].reverse().join(""),
    }),
    service = new ProviderService(store.providers, secrets);
  try {
    const saved = await service.save(namespaceA, validDraft, "original-secret"),
      ref = store.providers.get(namespaceA, saved.id).credentialRef;
    db.exec(
      "CREATE TRIGGER refuse_provider_update BEFORE UPDATE ON providers BEGIN SELECT RAISE(ABORT, 'injected database failure'); END;",
    );
    await expect(
      service.save(namespaceA, validDraft, "replacement-secret", saved.id),
    ).rejects.toThrow(/injected database failure/);
    expect(store.providers.get(namespaceA, saved.id).credentialRef).toBe(ref);
    expect((await service.resolve(namespaceA, saved.id)).apiKey).toBe(
      "original-secret",
    );
    expect(
      db.prepare("SELECT COUNT(*) AS count FROM credentials").get()?.count,
    ).toBe(1);
  } finally {
    db.close();
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
