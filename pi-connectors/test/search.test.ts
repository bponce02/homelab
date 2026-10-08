import test from 'node:test';
import assert from 'node:assert/strict';
import { zstdDecompressSync } from 'node:zlib';
import { streamSimple } from '@earendil-works/pi-ai/api/openai-codex-responses';
import type { Models, SimpleStreamOptions } from '@earendil-works/pi-ai';
import { CodexBackend, codexModels, toContext } from '../src/codex.ts';
import { nativeSearch } from '../src/search.ts';
import { patchProviderPayload } from '../src/native.ts';

const tool = { type: 'web_search', external_web_access: true };
test('native search is opt-in, validates declarations, and preserves ordinary tools', () => {
  assert.equal(nativeSearch(), undefined);
  assert.equal(nativeSearch([{ type: 'function' }]), undefined);
  assert.throws(() => nativeSearch([tool, tool]));
  assert.throws(() => nativeSearch([{ ...tool, endpoint: 'https://evil.example' }]));
  assert.throws(() => nativeSearch([{ ...tool, external_web_access: 'yes' }]));
  const payload = { tools: [{ type: 'function', name: 'lookup' }], include: ['reasoning.encrypted_content'] };
  const patched = nativeSearch([tool])!.onPayload(payload);
  assert.deepEqual(patched.tools, [...payload.tools, tool]);
  assert.deepEqual(patched.include, [...payload.include, 'web_search_call.action.sources']);
  assert.deepEqual(payload.tools, [{ type: 'function', name: 'lookup' }]);
  assert.equal(patchProviderPayload({ tools: [tool] }, { mode: 'live' }), undefined);
  const model = codexModels('/nonexistent').getModels('openai-codex')[0];
  assert.deepEqual(toContext({ messages: [{ role: 'user', content: 'Find' }], tools: [tool] }, model).tools, []);
});

test('captures native execution and deduplicated safe sources with bounded metadata', () => {
  const search = nativeSearch([tool])!;
  search.onProviderStreamEvent({ type: 'response.output_item.done', item: { type: 'web_search_call', status: 'completed', action: { sources: [{ url: 'https://example.com/?utm_source=openai' }, { url: 'javascript:alert(1)' }, { url: 'https://user:secret@example.com/' }] } } });
  search.onProviderStreamEvent({ type: 'response.output_text.annotation.added', annotation: { type: 'url_citation', url: 'https://example.com/', title: 'Official docs' } });
  assert.deepEqual(search.result(), { performed: true, sources: [{ url: 'https://example.com/', title: 'Official docs' }] });
  for (let i = 0; i < 50; i++) search.onProviderStreamEvent({ type: 'response.output_text.annotation.added', annotation: { type: 'url_citation', url: `https://example.com/${i}`, title: 'x'.repeat(500) } });
  assert.equal(search.result().sources.length, 20);
  assert.ok(search.result().sources.every(source => source.title.length <= 300));
});

test('real Pi Codex SSE adapter receives native declaration and forwards citations without executing a client tool', async () => {
  const model = codexModels('/nonexistent').getModels('openai-codex')[0];
  const source = { type: 'url_citation', url: 'https://example.com/docs', title: 'Docs', start_index: 0, end_index: 6 };
  const call = { id: 'ws_1', type: 'web_search_call', status: 'completed', action: { type: 'search', query: 'docs', sources: [{ url: source.url }] } };
  const message = { id: 'msg_1', type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'Answer', annotations: [source] }] };
  const events = [
    { type: 'response.output_item.added', output_index: 0, item: call },
    { type: 'response.output_item.done', output_index: 0, item: call },
    { type: 'response.output_item.added', output_index: 1, item: { ...message, content: [] } },
    { type: 'response.content_part.added', output_index: 1, content_index: 0, part: { type: 'output_text', text: '', annotations: [] } },
    { type: 'response.output_text.delta', output_index: 1, content_index: 0, delta: 'Answer' },
    { type: 'response.output_text.annotation.added', annotation: source },
    { type: 'response.output_item.done', output_index: 1, item: message },
    { type: 'response.completed', response: { status: 'completed', output: [call, message], usage: { input_tokens: 10, output_tokens: 3, total_tokens: 13 } } },
  ];
  let sent: Record<string, any> = {};
  const token = `header.${Buffer.from(JSON.stringify({ 'https://api.openai.com/auth': { chatgpt_account_id: 'test-account' } })).toString('base64url')}.signature`;
  const fetcher: typeof fetch = async (_url, options) => {
    const raw = Buffer.from(options!.body as Uint8Array);
    const compressed = new Headers(options?.headers).get('content-encoding') === 'zstd';
    sent = JSON.parse((compressed ? zstdDecompressSync(raw) : raw).toString());
    return new Response(events.map(event => `data: ${JSON.stringify(event)}\n\n`).join(''), { headers: { 'Content-Type': 'text/event-stream' } });
  };
  const models = { getModel: () => model, streamSimple: (_model: unknown, context: any, options: SimpleStreamOptions) => streamSimple({ ...model, api: 'openai-codex-responses' }, context, { ...options, apiKey: token, fetch: fetcher }) } as unknown as Models;
  const deltas: unknown[] = [];
  const result = await new CodexBackend(models).complete({ model: model.id, messages: [{ role: 'user', content: 'Find docs' }], tools: [tool], tool_choice: 'required' }, delta => deltas.push(delta), new AbortController().signal);
  assert.ok(sent.tools.some((value: any) => value.type === 'web_search'));
  assert.equal(sent.tool_choice, 'required');
  assert.ok(sent.include.includes('web_search_call.action.sources'));
  assert.equal(result.choices[0].message.content, 'Answer');
  assert.deepEqual(result.choices[0].message.native_search, { performed: true, sources: [{ title: 'Docs', url: source.url }] });
  assert.deepEqual(deltas, [{ content: 'Answer' }]);
});
