import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { setTimeout as delay } from 'node:timers/promises';
import extension from '../extension/index.ts';
import { SessionBackend } from '../src/sessions.ts';
import { localJson } from '../src/session-protocol.ts';
import { ApiError, type Body } from '../src/http.ts';

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'pi-bridge-'));
  const env = { PI_SESSION_BRIDGE_DIR: join(root, 'run'), HERDR_ENV: '1', HERDR_PANE_ID: 'w1:p1', HERDR_SOCKET_PATH: '/fake-herdr.sock' };
  const saved = Object.fromEntries(Object.keys(env).map(k => [k, process.env[k]]));
  Object.assign(process.env, env);
  const handlers = new Map<string, Function>();
  const prompts: string[] = [];
  const entries: any[] = [];
  let idle = true;
  let sessionId = 'session-one';
  const context = { isIdle: () => idle, hasPendingMessages: () => false, hasUI: false, sessionManager: { getSessionId: () => sessionId, getSessionFile: () => '/fake-session.jsonl', getEntries: () => entries } };
  const fire = async (event: string, data: Body = {}) => handlers.get(event)?.({ type: event, ...data }, context);
  extension({ on(event: string, handler: Function) { handlers.set(event, handler); }, appendEntry(customType: string, data: unknown) { entries.push({ type: 'custom', customType, data }); }, sendUserMessage(prompt: string) { prompts.push(prompt); } } as any);
  await fire('session_start');
  const config = join(root, 'sessions.json');
  await writeFile(config, JSON.stringify({ sessions: [{ id: 'homelab', name: 'Homelab', sessionId }] }));
  const state = join(root, 'state');
  const verify = async (meta: Body) => { assert.equal(meta.paneId, 'w1:p1'); assert.equal(meta.sessionFile, '/fake-session.jsonl'); };
  let backend = new SessionBackend(config, env.PI_SESSION_BRIDGE_DIR, state, verify);
  const socket = () => join(env.PI_SESSION_BRIDGE_DIR, `${sessionId}.sock`);
  return {
    root, config, prompts, entries, fire, socket,
    get backend() { return backend; },
    setIdle(value: boolean) { idle = value; },
    async waitForPrompt(count = 1) {
      for (let i = 0; prompts.length < count && i < 100; i++) await delay(10);
      assert.equal(prompts.length, count);
    },
    async finish(text = 'Hello 🌍') {
      await fire('message_start', { message: { role: 'assistant' } });
      await fire('message_update', { assistantMessageEvent: { type: 'text_delta', delta: text } });
      await fire('message_end', { message: { role: 'assistant', content: [{ type: 'text', text }], stopReason: 'stop' } });
      await fire('agent_settled');
    },
    restartGateway() { backend.close(); backend = new SessionBackend(config, env.PI_SESSION_BRIDGE_DIR, state, verify); },
    async restartExtension() { await fire('session_shutdown'); await fire('session_start'); },
    async switchSession() { sessionId = 'session-two'; await fire('session_start'); },
    async close() {
      await fire('session_shutdown'); backend.close(); await rm(root, { recursive: true, force: true });
      for (const [key, value] of Object.entries(saved)) if (value === undefined) delete process.env[key]; else process.env[key] = value;
    },
  };
}
const input = { model: 'pi/homelab', messages: [{ role: 'system', content: 'Not sent to Pi' }, { role: 'user', content: 'Old history' }, { role: 'assistant', content: 'Old reply' }, { role: 'user', content: 'New prompt only' }] };
const signal = () => AbortSignal.timeout(5000);
const error = (status: number) => (e: unknown) => e instanceof ApiError && e.status === status;

test('real Unix bridge: allowlist discovery, new prompt only, streaming, settlement, and durable replay', async t => {
  const app = await fixture(); t.after(() => app.close());
  assert.deepEqual(await app.backend.list(), [{ id: 'pi/homelab', name: 'Homelab' }]);
  assert.equal((await stat(app.socket())).mode & 0o777, 0o600);
  const deltas: string[] = [];
  const work = app.backend.complete(input, delta => deltas.push(String(delta.content)), signal());
  await app.waitForPrompt();
  assert.deepEqual(app.prompts, ['New prompt only']);
  assert.equal((await localJson(app.socket(), '/status')).busy, true);
  assert.deepEqual(await app.fire('input', { source: 'interactive', text: 'local prompt' }), { action: 'handled' });
  await app.fire('message_end', { message: { role: 'assistant', content: [], stopReason: 'error' } });
  await app.fire('agent_end');
  assert.equal((await localJson(app.socket(), '/status')).busy, true, 'agent_end after a retryable error is not final settlement');
  await app.finish();
  const result = await work;
  assert.equal(result.choices[0].message.content, 'Hello 🌍');
  assert.equal(deltas.join(''), 'Hello 🌍');
  app.restartGateway();
  const replay = await app.backend.complete(input, () => {}, signal());
  assert.deepEqual(replay, result); assert.equal(app.prompts.length, 1);
});

test('unknown, busy, command, attachment, and nested tool requests do not reach Pi', async t => {
  const app = await fixture(); t.after(() => app.close());
  await assert.rejects(app.backend.complete({ ...input, model: 'pi/not-allowed' }, () => {}, signal()), error(404));
  await assert.rejects(app.backend.complete({ ...input, tools: [{}] }, () => {}, signal()), error(400));
  for (const content of ['/new', '!rm -rf /', [{ type: 'image_url' }]]) await assert.rejects(app.backend.complete({ ...input, messages: [{ role: 'user', content }] }, () => {}, signal()), error(400));
  app.setIdle(false);
  await assert.rejects(app.backend.complete(input, () => {}, signal()), error(409));
  app.setIdle(true);
  assert.equal(app.prompts.length, 0);
});

test('concurrent requests never overlap and duplicate in-flight requests are not submitted twice', async t => {
  const app = await fixture(); t.after(() => app.close());
  const first = app.backend.complete(input, () => {}, signal());
  await app.waitForPrompt();
  await assert.rejects(app.backend.complete(input, () => {}, signal()), error(409));
  await assert.rejects(app.backend.complete({ ...input, messages: [{ role: 'user', content: 'Other work' }] }, () => {}, signal()), error(409));
  await app.finish(); await first;
  assert.equal(app.prompts.length, 1);
});

test('disconnect does not interrupt the local agent or automatically replay side effects', async t => {
  const app = await fixture(); t.after(() => app.close());
  const abort = new AbortController();
  const first = app.backend.complete(input, () => {}, abort.signal);
  const rejected = assert.rejects(first, error(502));
  await app.waitForPrompt(); abort.abort(); await rejected;
  assert.equal((await localJson(app.socket(), '/status')).busy, true);
  await app.finish();
  await app.restartExtension(); app.restartGateway();
  await assert.rejects(app.backend.complete(input, () => {}, signal()), error(409));
  assert.equal(app.prompts.length, 1);
  assert.equal(app.entries.length, 1);
});

test('explicit idempotency keys cannot be reused for different content', async t => {
  const app = await fixture(); t.after(() => app.close());
  const first = app.backend.complete(input, () => {}, signal(), 'one'); await app.waitForPrompt(); await app.finish(); await first;
  await assert.rejects(app.backend.complete({ ...input, messages: [{ role: 'user', content: 'Different' }] }, () => {}, signal(), 'one'), error(409));
});

test('session replacement unregisters the previous session and cleans sockets on shutdown', async t => {
  const app = await fixture(); t.after(() => app.close());
  const oldSocket = app.socket(); await app.switchSession();
  assert.deepEqual(await app.backend.list(), []);
  await assert.rejects(readFile(oldSocket), { code: 'ENOENT' });
  await assert.rejects(app.backend.complete(input, () => {}, signal()), error(503));
});

test('identity mismatch is not silently redirected to another pane/session', async t => {
  const app = await fixture(); t.after(() => app.close());
  const path = join(app.root, 'run', 'session-one.json');
  const meta = JSON.parse(await readFile(path, 'utf8')); meta.nonce = 'wrong'; await writeFile(path, JSON.stringify(meta));
  assert.deepEqual(await app.backend.list(), []);
  await assert.rejects(app.backend.complete(input, () => {}, signal()), error(409));
  assert.equal(app.prompts.length, 0);
});
