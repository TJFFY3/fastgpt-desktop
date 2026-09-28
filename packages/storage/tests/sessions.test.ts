import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openStore, namespaceKey, type Store } from '../src/index';
import { namespaceA, namespaceB, validDraft } from '../../../tests/fixtures/data';
let dir: string, store: Store, path: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'fastgpt-store-')); path = join(dir, 'test.sqlite'); store = openStore(path); });
afterEach(() => { store.close(); rmSync(dir, { recursive: true, force: true }); });
function create() { const p = store.providers.save(namespaceA, validDraft, null); return store.sessions.create(namespaceA, { title: '你好', providerId: p.id }); }
describe('persistent sessions', () => {
  it('retains ordered messages and user changes across reopen', () => {
    const s = create();
    store.sessions.appendMessage(namespaceA, s.id, { role: 'user', content: '你好' }, 'complete');
    store.sessions.appendMessage(namespaceA, s.id, { role: 'assistant', content: '你好，我是助手' }, 'complete');
    store.sessions.update(namespaceA, s.id, { title: '新标题', pinned: true });
    store.close(); store = openStore(path);
    expect(store.sessions.messages(namespaceA, s.id).map(m => m.content)).toEqual(['你好', '你好，我是助手']);
    expect(store.sessions.get(namespaceA, s.id)).toMatchObject({ title: '新标题', pinned: true });
  });
  it('refuses cross-identity reads, updates, deletes and provider association', () => {
    const s = create();
    expect(store.sessions.list(namespaceB, {})).toEqual([]);
    expect(() => store.sessions.get(namespaceB, s.id)).toThrow(/NOT_FOUND/);
    expect(() => store.sessions.update(namespaceB, s.id, { title: 'stolen' })).toThrow(/NOT_FOUND/);
    expect(() => store.sessions.remove(namespaceB, s.id)).toThrow(/NOT_FOUND/);
    expect(() => store.sessions.create(namespaceB, { title: 'x', providerId: s.providerId })).toThrow(/NOT_FOUND/);
  });
  it('treats SQL metacharacters and wildcard search as literal data', () => {
    const s = create(); store.sessions.update(namespaceA, s.id, { title: "'; DROP TABLE sessions; -- %_" });
    expect(store.sessions.list(namespaceA, { query: '%_' }).map(s => s.id)).toEqual([s.id]);
    expect(store.sessions.list(namespaceA, { query: 'absent' })).toEqual([]);
    store.sessions.update(namespaceA, s.id, { archived: true });
    expect(store.sessions.list(namespaceA, { archived: false })).toEqual([]);
    expect(store.sessions.list(namespaceA, { archived: true })).toHaveLength(1);
  });
  it('does not collide identities containing separator characters', () => {
    expect(namespaceKey({ instanceId: 'a|b', accountId: 'c', teamId: 'd' })).not.toBe(namespaceKey({ instanceId: 'a', accountId: 'b|c', teamId: 'd' }));
  });
});
