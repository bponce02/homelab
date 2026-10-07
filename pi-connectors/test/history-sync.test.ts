import test from 'node:test';
import assert from 'node:assert/strict';
import { historyMessages } from '../src/session-history.ts';
import { syncOnce } from '../src/librechat-sync.ts';

const entry = (id: string, role: string, content: unknown) => ({ type: 'message', id, timestamp: '2026-10-01T00:00:00Z', message: { role, content } });

test('history contains only visible text and merges assistant steps into one reply', () => {
  const remote = { conversationId: 'chat', userMessageId: 'user', responseMessageId: 'answer' };
  const result = historyMessages([
    entry('system', 'system', 'secret instructions'),
    { type: 'custom', customType: 'pi-gateway-request', data: { id: 'request', remote } },
    entry('one', 'user', [{ type: 'text', text: 'Hello 🌍' }, { type: 'image', data: 'private image' }]),
    entry('two', 'assistant', [{ type: 'thinking', thinking: 'private reasoning' }, { type: 'text', text: 'Working' }, { type: 'toolCall', arguments: { secret: 'key' } }]),
    entry('tool', 'toolResult', [{ type: 'text', text: 'secret logs' }]),
    entry('three', 'assistant', [{ type: 'text', text: 'Finished' }]),
    entry('four', 'user', 'Terminal prompt'),
  ]);
  assert.equal(result.length, 3);
  assert.equal(result[1].text, 'Working\n\nFinished');
  assert.deepEqual(result[0].remote, remote);
  assert.equal(result[2].remote, undefined);
  assert.doesNotMatch(JSON.stringify(result), /private|secret/);
});

test('sync retries failures and does not acknowledge until the server succeeds', async () => {
  const snapshots = async function* () { yield { sessionId: 'one', messages: [] }; };
  const sent = new Map<string, string>();
  const signal = new AbortController().signal;
  let calls = 0;
  const send = (async (_url: unknown, options: RequestInit) => {
    calls++;
    assert.equal(options.redirect, 'error');
    assert.equal((options.headers as Record<string, string>).Authorization, 'Bearer key');
    return new Response('{}', { status: calls === 1 ? 503 : 200 });
  }) as typeof fetch;
  await assert.rejects(syncOnce(snapshots(), 'https://example.test/api/pi-sync', 'key', signal, sent, send), /503/);
  assert.equal(sent.size, 0);
  await syncOnce(snapshots(), 'https://example.test/api/pi-sync', 'key', signal, sent, send);
  await syncOnce(snapshots(), 'https://example.test/api/pi-sync', 'key', signal, sent, send);
  assert.equal(calls, 2);
});
