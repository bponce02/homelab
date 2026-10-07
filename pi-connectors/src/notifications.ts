import { readFile, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

export interface NotificationConfig { url: string; keyFile: string }
export async function sendNotification(
  config: NotificationConfig,
  sessionId: string,
  toolCallId: string,
  input: { title: string; body: string },
  signal?: AbortSignal,
  send = fetch,
) {
  const url = new URL(config.url);
  if ((url.protocol !== 'https:' && !(url.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(url.hostname))) || url.username || url.password || url.search || url.hash) throw new Error('Invalid LibreChat notification URL');
  if (!/^[a-zA-Z0-9-]{1,64}$/.test(sessionId) || !toolCallId || toolCallId.length > 256) throw new Error('Invalid Pi notification identity');
  const info = await stat(config.keyFile);
  if (!info.isFile() || (info.mode & 0o077) !== 0) throw new Error('Notification key file must be private');
  const key = (await readFile(config.keyFile, 'utf8')).trim();
  if (key.length < 32) throw new Error('Invalid notification credential');
  const response = await send(url.href, { method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }, redirect: 'error', signal: AbortSignal.any([...(signal ? [signal] : []), AbortSignal.timeout(30000)]), body: JSON.stringify({ sessionId, toolCallId, title: input.title, body: input.body }) });
  if (!response.ok) {
    await response.body?.cancel();
    throw new Error(`LibreChat notification unavailable (HTTP ${response.status}); session must be synced first`);
  }
  const text = await response.text();
  if (text.length > 16384) throw new Error('Notification response exceeded limit');
  const result = JSON.parse(text);
  if (result?.ok !== true || result.status !== 'queued') throw new Error('Unexpected notification response');
  return { ok: true, status: 'queued', duplicate: result.duplicate === true, push: result.push ? { accepted: Number(result.push.accepted) || 0, failed: Number(result.push.failed) || 0 } : undefined };
}
export async function notificationConfig(): Promise<NotificationConfig> {
  const path = process.env.PI_LIBRECHAT_NOTIFY_CONFIG ?? join(homedir(), '.local/state/pi-gateway/librechat-notify.json');
  const config = JSON.parse(await readFile(path, 'utf8'));
  if (!config || typeof config.url !== 'string' || typeof config.keyFile !== 'string') throw new Error('LibreChat notifications are not configured');
  return { url: config.url, keyFile: config.keyFile };
}
