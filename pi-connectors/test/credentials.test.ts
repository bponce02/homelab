import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, stat, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { FileCredentials } from '../src/credentials.ts';
import { lines } from '../src/session-protocol.ts';

test('credential mutations are cross-process serialized, atomic, private, and survive restart', async t => {
  const root = await mkdtemp(join(tmpdir(), 'pi-auth-test-')); t.after(() => rm(root, { recursive: true, force: true }));
  const store = new FileCredentials(root);
  assert.equal(await store.read('openai-codex'), undefined);
  await store.modify('openai-codex', async () => ({ type: 'oauth', access: 'test-access', refresh: 'test-refresh', expires: 0, counter: 0 }));
  const script = `import { FileCredentials } from './src/credentials.ts'; const store = new FileCredentials(process.argv[1]); await store.modify('openai-codex', async value => { await new Promise(r => setTimeout(r, 20)); return {...value, counter: Number(value.counter) + 1}; });`;
  await Promise.all(Array.from({ length: 4 }, () => promisify(execFile)(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', script, root])));
  const reloaded = new FileCredentials(root);
  const credential = await reloaded.read('openai-codex');
  assert.equal(credential?.type, 'oauth');
  assert.equal(credential?.type === 'oauth' && credential.counter, 4);
  assert.equal((await stat(join(root, 'auth.json'))).mode & 0o777, 0o600);
  assert.equal((await stat(root)).mode & 0o777, 0o700);
  assert.deepEqual(await store.list(), [{ providerId: 'openai-codex', type: 'oauth' }]);
  await store.modify('openai-codex', async () => undefined);
  assert.deepEqual(await store.read('openai-codex'), credential);
  await assert.rejects(store.modify('openai-codex', async () => { throw new Error('refresh failed'); }));
  assert.deepEqual(await store.read('openai-codex'), credential);
  await store.delete('openai-codex'); assert.deepEqual(JSON.parse(await readFile(join(root, 'auth.json'), 'utf8')), {});
});

test('NDJSON decoding preserves Unicode across byte boundaries and rejects incomplete streams', async () => {
  const raw = Buffer.from('{"type":"delta","text":"🌍"}\n');
  async function* bytes() { for (const byte of raw) yield Buffer.from([byte]); }
  const events = []; for await (const frame of lines(bytes())) events.push(frame);
  assert.deepEqual(events, [{ type: 'delta', text: '🌍' }]);
  async function* broken() { yield Buffer.from('{"type":'); }
  await assert.rejects(async () => { for await (const _ of lines(broken())) {} }, /Truncated/);
});
