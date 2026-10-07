import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import type { Body } from './http.ts';

export async function syncOnce(snapshots: AsyncIterable<Body>, url: string, key: string, signal: AbortSignal, sent = new Map<string, string>(), send = fetch) {
  let failedStatus: number | undefined;
  for await (const snapshot of snapshots) {
    const body = JSON.stringify(snapshot);
    const digest = createHash('sha256').update(body).digest('hex');
    if (sent.get(snapshot.sessionId) === digest) continue;
    const response = await send(url, { method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }, body, signal: AbortSignal.any([signal, AbortSignal.timeout(30_000)]), redirect: 'error' });
    if (!response.ok) {
      await response.body?.cancel();
      failedStatus = response.status;
      continue;
    }
    await response.body?.cancel();
    sent.set(snapshot.sessionId, digest);
  }
  if (failedStatus !== undefined) throw new Error(`LibreChat sync HTTP ${failedStatus}`);
}
export async function startHistorySync(snapshots: () => AsyncIterable<Body>) {
  const target = process.env.PI_LIBRECHAT_SYNC_URL;
  if (!target) return async () => {};
  const url = new URL(target);
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(url.hostname))) throw new Error('History sync requires HTTPS');
  if (url.username || url.password || url.search || url.hash) throw new Error('Invalid history sync URL');
  const key = (await readFile(process.env.PI_LIBRECHAT_SYNC_KEY_FILE!, 'utf8')).trim();
  if (key.length < 32) throw new Error('Sync key must contain at least 32 characters');
  const abort = new AbortController();
  const sent = new Map<string, string>();
  const task = (async () => {
    while (!abort.signal.aborted) {
      try { await syncOnce(snapshots(), url.href, key, abort.signal, sent); }
      catch (error) { if (!abort.signal.aborted) console.error(error instanceof Error && /^LibreChat sync HTTP \d+$/.test(error.message) ? error.message : 'LibreChat history sync failed; retrying'); }
      await delay(10_000, undefined, { signal: abort.signal }).catch(() => {});
    }
  })();
  return async () => { abort.abort(); await task; };
}
