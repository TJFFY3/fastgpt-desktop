import { expect, it } from 'vitest';
import { openStore } from '../src/index';
import { namespaceA, namespaceB, validDraft } from '../../../tests/fixtures/data';
it('isolates model profiles and encrypted credential records', () => {
  const s = openStore(':memory:');
  try {
    const p = s.providers.save(namespaceA, validDraft, 'ref');
    s.credentials.put(namespaceA, 'ref', new Uint8Array([1, 2, 3]));
    expect(s.providers.list(namespaceB)).toEqual([]);
    expect(s.credentials.get(namespaceB, 'ref')).toBeNull();
    expect(s.credentials.get(namespaceA, 'ref')).toEqual(new Uint8Array([1, 2, 3]));
    expect(() => s.providers.remove(namespaceB, p.id)).toThrow(/NOT_FOUND/);
    s.sessions.create(namespaceA, { title: 'uses provider', providerId: p.id });
    expect(() => s.providers.remove(namespaceA, p.id)).toThrow(/INVALID_INPUT/);
    s.credentials.remove(namespaceA, 'ref'); expect(s.credentials.get(namespaceA, 'ref')).toBeNull();
  } finally { s.close(); }
});
