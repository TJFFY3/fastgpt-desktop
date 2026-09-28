import { expect, it } from "vitest";
import { SecretStore, type SafeStorageBackend } from "../src/main/credentials";
import { openStore } from "../../../packages/storage/src/index";
import { namespaceA, namespaceB } from "../../../tests/fixtures/data";
function backend(secure = true, available = true): SafeStorageBackend {
  return {
    isAvailable: async () => available,
    isSecure: async () => secure,
    encrypt: async (s) => new TextEncoder().encode([...s].reverse().join("")),
    decrypt: async (s) => [...new TextDecoder().decode(s)].reverse().join(""),
  };
}
it("stores only ciphertext and enforces credential ownership", async () => {
  const store = openStore(":memory:");
  const secrets = new SecretStore(store.credentials, backend());
  try {
    const saved = await secrets.put("secret-for-test", namespaceA);
    expect(saved.state).toBe("persistent");
    expect(
      new TextDecoder().decode(store.credentials.get(namespaceA, saved.ref)!),
    ).not.toContain("secret-for-test");
    expect(await secrets.get(saved.ref, namespaceA)).toBe("secret-for-test");
    expect(await secrets.get(saved.ref, namespaceB)).toBeNull();
    await secrets.remove(saved.ref, namespaceB);
    expect(await secrets.get(saved.ref, namespaceA)).toBe("secret-for-test");
  } finally {
    store.close();
  }
});
it.each([
  [false, true],
  [true, false],
])(
  "uses memory when backend secure=%s available=%s",
  async (secure, available) => {
    const store = openStore(":memory:");
    try {
      const secrets = new SecretStore(
        store.credentials,
        backend(secure, available),
      );
      const saved = await secrets.put("secret-for-test", namespaceA);
      expect(saved.state).toBe("session_only");
      expect(store.credentials.get(namespaceA, saved.ref)).toBeNull();
      expect(await secrets.get(saved.ref, namespaceA)).toBe("secret-for-test");
      secrets.clearSessionOnly();
      expect(await secrets.get(saved.ref, namespaceA)).toBeNull();
      expect(secrets.status(saved.ref, namespaceA)).toBe("missing");
    } finally {
      store.close();
    }
  },
);
it("keeps plaintext in memory if OS encryption throws", async () => {
  const store = openStore(":memory:");
  const b = backend();
  b.encrypt = async () => {
    throw new Error("keychain locked");
  };
  try {
    expect(
      (
        await new SecretStore(store.credentials, b).put(
          "secret-for-test",
          namespaceA,
        )
      ).state,
    ).toBe("session_only");
  } finally {
    store.close();
  }
});
