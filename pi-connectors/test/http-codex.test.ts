import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createModels, fauxProvider, fauxAssistantMessage, fauxText, fauxToolCall } from '@earendil-works/pi-ai';
import { apiServer, ApiError, type Backend, type Body } from '../src/http.ts';
import { CodexBackend, codexModels, toContext } from '../src/codex.ts';

const key = 'a'.repeat(48);
async function fixture(backend: Backend, timeout = 10_000) {
  const server = apiServer(backend, key, timeout);
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const address = server.address() as import('node:net').AddressInfo;
  return {
    url: `http://127.0.0.1:${address.port}`,
    async request(body: Body) { return fetch(`${this.url}/v1/chat/completions`, { method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); },
    async close() { server.closeAllConnections(); await new Promise<void>(done => server.close(() => done())); },
  };
}
function mock() {
  const faux = fauxProvider({ models: [{ id: 'test-model' }], tokensPerSecond: 0 });
  const models = createModels(); models.setProvider(faux.provider);
  return { faux, models, backend: new CodexBackend(models, faux.provider.id) };
}
const input = { model: 'test-model', messages: [{ role: 'user', content: 'Hi' }] };

test('authentication, model listing, validation, and health do not call a model', async t => {
  const { backend, faux } = mock(); const app = await fixture(backend); t.after(() => app.close());
  assert.equal((await fetch(`${app.url}/health`)).status, 200);
  assert.equal((await fetch(`${app.url}/v1/models`)).status, 401);
  const listed = await fetch(`${app.url}/v1/models`, { headers: { Authorization: `Bearer ${key}` } });
  assert.equal((await listed.json() as Body).data[0].id, 'test-model');
  assert.equal((await fetch(`${app.url}/v1/models`, { headers: { Authorization: `Bearer ${key}`, Origin: 'https://evil.example' } })).status, 403);
  assert.equal((await app.request({ model: 'test-model' })).status, 400);
  assert.equal((await app.request({ ...input, n: 2 })).status, 400);
  assert.equal((await app.request({ ...input, model: 'unknown' })).status, 404);
  assert.equal((await app.request({ ...input, response_format: { type: 'json_object' } })).status, 400);
  assert.equal(faux.state.callCount, 0);
});

test('Pi library translates nonstreaming and streaming tool calls without executing tools', async t => {
  const { backend, faux } = mock(); const app = await fixture(backend); t.after(() => app.close());
  const answer = fauxAssistantMessage([fauxText('Let me check.'), fauxToolCall('lookup', { query: 'hello' }, { id: 'call_1' })], { stopReason: 'toolUse' });
  faux.setResponses([answer, answer]);
  const request = { ...input, tools: [{ type: 'function', function: { name: 'lookup', parameters: { type: 'object', properties: { query: { type: 'string' } } } } }] };
  const result = await (await app.request(request)).json() as Body;
  assert.equal(result.choices[0].finish_reason, 'tool_calls');
  assert.deepEqual(result.choices[0].message.tool_calls[0], { id: 'call_1', type: 'function', function: { name: 'lookup', arguments: '{"query":"hello"}' } });
  const streamed = await (await app.request({ ...request, stream: true, stream_options: { include_usage: true } })).text();
  assert.ok(streamed.endsWith('data: [DONE]\n\n'));
  const events = streamed.split('\n').filter(line => line.startsWith('data: {')).map(line => JSON.parse(line.slice(6)));
  assert.equal(new Set(events.map(e => e.id)).size, 1);
  assert.equal(events.flatMap(e => e.choices).map(c => c.delta?.content ?? '').join(''), 'Let me check.');
  assert.equal(events.flatMap(e => e.choices).flatMap(c => c.delta?.tool_calls ?? [])[0].function.arguments, '{"query":"hello"}');
  assert.ok(events.some(e => e.usage));
  assert.equal(faux.state.callCount, 2);
});

test('history, tool results, and inline images are translated; external images and malformed calls are rejected', () => {
  const { faux } = mock(); const model = faux.getModel();
  const messages = [
    { role: 'system', content: 'Be helpful' },
    { role: 'user', content: [{ type: 'image_url', image_url: { url: 'data:image/png;base64,AAAA' } }] },
    { role: 'assistant', content: null, tool_calls: [{ type: 'function', id: 't1', function: { name: 'lookup', arguments: '{"x":1}' } }] },
    { role: 'tool', tool_call_id: 't1', content: 'result' },
    { role: 'user', content: 'Continue' },
  ];
  const context = toContext({ messages }, model);
  assert.equal(context.messages[3].role, 'toolResult');
  assert.equal((context.messages[1].content as any[])[0].mimeType, 'image/png');
  assert.throws(() => toContext({ messages: [{ role: 'tool', tool_call_id: 'missing', content: '' }] }, model), ApiError);
  assert.throws(() => toContext({ messages: [{ role: 'user', content: [{ type: 'image_url', image_url: { url: 'http://127.0.0.1/secret' } }] }] }, model), ApiError);
  assert.throws(() => toContext({ messages: [{ ...messages[2], tool_calls: [{ type: 'function', id: 't', function: { name: 'f', arguments: '[]' } }] }] }, model), ApiError);
});

test('reader PNG and JPEG blocks remain images in tool results and projected user turns', () => {
  const { faux } = mock();
  for (const mimeType of ['image/png', 'image/jpeg']) {
    const image = { type: 'image_url', image_url: { url: `data:${mimeType};base64,/9j/4A==` } };
    const context = toContext({ messages: [
      { role: 'assistant', content: null, tool_calls: [{ type: 'function', id: 'read_1', function: { name: 'read_file', arguments: '{"path":"/tmp/image"}' } }] },
      { role: 'tool', tool_call_id: 'read_1', content: [image] },
      { role: 'user', content: [image] },
    ] }, faux.getModel());
    for (const message of context.messages.slice(1)) {
      assert.deepEqual(message.content, [{ type: 'image', mimeType, data: '/9j/4A==' }]);
    }
  }
});

test('upstream errors are sanitized and cancellation reaches the backend', async t => {
  let cancelled = false;
  const backend: Backend = {
    async list() { return []; },
    async complete(_body, _emit, signal) {
      await new Promise<void>(resolve => signal.addEventListener('abort', () => { cancelled = true; resolve(); }, { once: true }));
      throw new Error('SECRET upstream error');
    },
  };
  const app = await fixture(backend, 30); t.after(() => app.close());
  const result = await app.request(input);
  assert.equal(result.status, 502); assert.equal(cancelled, true);
  assert.ok(!(await result.text()).includes('SECRET'));
});

test('client disconnect aborts upstream work', async t => {
  let finish!: () => void;
  const stopped = new Promise<void>(resolve => { finish = resolve; });
  const app = await fixture({ async list() { return []; }, async complete(_body, emit, signal) {
    emit({ content: 'started' });
    await new Promise<void>(resolve => signal.addEventListener('abort', () => { finish(); resolve(); }, { once: true }));
    throw new ApiError(504, 'Aborted');
  } });
  t.after(() => app.close());
  const controller = new AbortController();
  const result = await fetch(`${app.url}/v1/chat/completions`, { method: 'POST', headers: { Authorization: `Bearer ${key}` }, body: JSON.stringify({ ...input, stream: true }), signal: controller.signal });
  await result.body!.getReader().read(); controller.abort();
  await stopped;
});

test('malformed and oversized bodies are rejected before inference', async t => {
  const { backend, faux } = mock(); const app = await fixture(backend); t.after(() => app.close());
  const malformed = await fetch(`${app.url}/v1/chat/completions`, { method: 'POST', headers: { Authorization: `Bearer ${key}` }, body: '{broken' });
  assert.equal(malformed.status, 400); await malformed.text();
  const oversized = await app.request({ ...input, messages: [{ role: 'user', content: 'x'.repeat(8 * 1024 * 1024) }] });
  assert.equal(oversized.status, 413); await oversized.text();
  assert.equal(faux.state.callCount, 0);
});

test('errors after SSE starts remain structured and hide upstream secrets', async t => {
  const app = await fixture({ async list() { return []; }, async complete(_body, emit) { emit({ content: 'partial' }); throw new Error('SECRET'); } });
  t.after(() => app.close());
  const result = await app.request({ ...input, stream: true });
  const text = await result.text();
  assert.equal(result.status, 200);
  assert.ok(text.includes('"error":'));
  assert.ok(text.endsWith('data: [DONE]\n\n'));
  assert.ok(!text.includes('SECRET'));
});

test('Codex discovery is available without OAuth and no credentials are read from existing Pi', async () => {
  const models = codexModels('/nonexistent-test-credentials');
  const backend = new CodexBackend(models);
  assert.ok((await backend.list()).length > 0);
});
