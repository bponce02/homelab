import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, chmod, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sendNotification } from '../src/notifications.ts';

test('notification forwarding uses session/call identity, private credentials and no redirects', async () => {
  const root = await mkdtemp(join(tmpdir(), 'pi-notify-'));
  const keyFile = join(root, 'key');
  await writeFile(keyFile, 'k'.repeat(32), { mode: 0o600 });
  const seen: RequestInit[] = [];
  const send: typeof fetch = async (_url, init) => { seen.push(init!); return new Response(JSON.stringify({ ok: true, status: 'queued', duplicate: true })); };
  const config = { url: 'https://librechat.example/api/pi-sync/notifications', keyFile };
  try {
    const result = await sendNotification(config, 'session', 'call', { title: 'Done', body: 'Finished' }, undefined, send);
    assert.equal(result.duplicate, true);
    assert.equal(seen[0].redirect, 'error');
    assert.deepEqual(JSON.parse(String(seen[0].body)), { sessionId: 'session', toolCallId: 'call', title: 'Done', body: 'Finished' });
    await chmod(keyFile, 0o644);
    await assert.rejects(sendNotification(config, 'session', 'call', { title: 'Done', body: 'Finished' }, undefined, send), /private/);
    assert.equal(seen.length, 1);
    await assert.rejects(sendNotification({ ...config, url: 'http://remote.example/api' }, 'session', 'call', { title: 'Done', body: 'Finished' }, undefined, send), /URL/);
  } finally { await rm(root, { recursive: true, force: true }); }
});
