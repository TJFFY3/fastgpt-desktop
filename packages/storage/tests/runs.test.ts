import { afterEach, beforeEach, expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openStore, type Store } from '../src/index';
import { namespaceA, namespaceB, validDraft } from '../../../tests/fixtures/data';
let dir: string, store: Store, path: string, sessionId: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'fastgpt-runs-')); path = join(dir, 'test.sqlite'); store = openStore(path); const p = store.providers.save(namespaceA, validDraft, null); sessionId = store.sessions.create(namespaceA, { title: '运行', providerId: p.id }).id; });
afterEach(() => { store.close(); rmSync(dir, { recursive: true, force: true }); });
it('rejects concurrent runs atomically without writing a second message', () => {
  store.runs.createWithUserMessage(namespaceA, sessionId, 'first');
  expect(() => store.runs.createWithUserMessage(namespaceA, sessionId, 'second')).toThrow(/RUN_ACTIVE/);
  expect(store.sessions.messages(namespaceA, sessionId).map(m => m.content)).toEqual(['first']);
  expect(() => store.sessions.remove(namespaceA, sessionId)).toThrow(/RUN_ACTIVE/);
});
it('rolls back a user message if the run insert fails', () => {
  const db = new DatabaseSync(path); db.exec("CREATE TRIGGER abort_run BEFORE INSERT ON runs BEGIN SELECT RAISE(ABORT, 'injected failure'); END;"); db.close();
  expect(() => store.runs.createWithUserMessage(namespaceA, sessionId, 'not committed')).toThrow();
  expect(store.sessions.messages(namespaceA, sessionId)).toEqual([]);
});
it('orders durable events and blocks cross-identity access', () => {
  const r = store.runs.createWithUserMessage(namespaceA, sessionId, 'hi');
  store.runs.appendEvent(namespaceA, r.id, { type: 'text_delta', text: '一' });
  store.runs.appendEvent(namespaceA, r.id, { type: 'text_delta', text: '二' });
  expect(store.runs.events(namespaceA, r.id, 0).map(e => e.seq)).toEqual([1, 2]);
  expect(store.runs.events(namespaceA, r.id, 1)).toHaveLength(1);
  expect(() => store.runs.events(namespaceB, r.id, 0)).toThrow(/NOT_FOUND/);
});
it('recovers active runs once and preserves terminal states', () => {
  const r = store.runs.createWithUserMessage(namespaceA, sessionId, 'hi'); store.runs.transition(namespaceA, r.id, 'running');
  expect(store.runs.recoverInterrupted()).toBe(1); expect(store.runs.get(namespaceA, r.id).status).toBe('interrupted');
  expect(store.runs.recoverInterrupted()).toBe(0);
  const r2 = store.runs.createWithUserMessage(namespaceA, sessionId, 'again'); store.runs.transition(namespaceA, r2.id, 'running'); store.runs.transition(namespaceA, r2.id, 'completed');
  expect(() => store.runs.transition(namespaceA, r2.id, 'running')).toThrow(/INVALID_INPUT/);
  expect(store.runs.recoverInterrupted()).toBe(0);
});
it('reserves each tool call once, retains results and rejects changed arguments', () => {
  const r = store.runs.createWithUserMessage(namespaceA, sessionId, 'hi'); const call = { id: 'c1', name: 'get_current_time', arguments: '{}' };
  expect(store.runs.reserveToolCall(namespaceA, r.id, call)).toBe('reserved');
  expect(store.runs.reserveToolCall(namespaceA, r.id, call)).toBe('unresolved');
  store.runs.completeToolCall(namespaceA, r.id, 'c1', { content: 'value', isError: false });
  expect(store.runs.reserveToolCall(namespaceA, r.id, call)).toBe('completed');
  expect(store.runs.toolResult(namespaceA, r.id, 'c1')).toEqual({ content: 'value', isError: false });
  expect(() => store.runs.reserveToolCall(namespaceA, r.id, { ...call, arguments: '{"x":1}' })).toThrow(/MODEL_PROTOCOL_ERROR/);
});
it('retains streamed partial text and a recovery event after an application restart', () => {
  const r = store.runs.createWithUserMessage(namespaceA, sessionId, 'hi');
  store.runs.transition(namespaceA, r.id, 'running');
  store.runs.appendEvent(namespaceA, r.id, { type: 'text_delta', text: '未完成回复' });
  store.close(); store = openStore(path); store.runs.recoverInterrupted();
  expect(store.sessions.messages(namespaceA, sessionId).at(-1)).toMatchObject({ content: '未完成回复', status: 'interrupted' });
  expect(store.runs.events(namespaceA, r.id).at(-1)).toMatchObject({ type: 'status', status: 'interrupted' });
  store.runs.recoverInterrupted(); expect(store.sessions.messages(namespaceA, sessionId)).toHaveLength(2);
});
