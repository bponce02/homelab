import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { homedir } from 'node:os';
import lockfile from 'proper-lockfile';
import { apiServer, type Backend } from './http.ts';

const mode = process.env.PI_CONNECTOR_MODE ?? 'sessions';
if (!['sessions', 'codex'].includes(mode)) throw new Error('PI_CONNECTOR_MODE must be sessions or codex');
const state = resolve(process.env.PI_CONNECTOR_STATE ?? './state');
const host = process.env.PI_CONNECTOR_HOST ?? '127.0.0.1';
const port = Number(process.env.PI_CONNECTOR_PORT ?? (mode === 'sessions' ? 8787 : 8788));
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid port');
if (mode === 'sessions' && host !== '127.0.0.1' && !/^100\.(?:6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.(?:\d{1,3})\.(?:\d{1,3})$/.test(host)) throw new Error('Session gateway must bind to loopback or a Tailscale IPv4 address');
const key = (await readFile(process.env.PI_CONNECTOR_KEY_FILE ?? join(state, 'client.key'), 'utf8')).trim();
await mkdir(state, { recursive: true, mode: 0o700 });
const owner = join(state, '.server-lock');
await writeFile(owner, '', { flag: 'a', mode: 0o600 });
const release = await lockfile.lock(owner, { stale: 30_000, update: 10_000, retries: 0 });
let backend: Backend;
let cleanup: () => void | Promise<void> = () => {};
if (mode === 'codex') {
  const { codexModels, CodexBackend } = await import('./codex.ts');
  backend = new CodexBackend(codexModels(state));
} else {
  const { SessionBackend } = await import('./sessions.ts');
  const sessions = new SessionBackend(process.env.PI_SESSIONS_CONFIG ?? './sessions.json', process.env.PI_SESSION_BRIDGE_DIR ?? join(homedir(), '.local/state/pi-gateway/run'), state);
  const { startHistorySync } = await import('./librechat-sync.ts');
  const stopSync = await startHistorySync(() => sessions.snapshots());
  backend = sessions; cleanup = async () => { await stopSync(); sessions.close(); };
}
const server = apiServer(backend, key);
server.requestTimeout = 60_000;
server.headersTimeout = 30_000;
server.listen(port, host, () => console.log(`${mode} connector listening on ${host}:${port}`));
let stopping = false;
const stop = async () => {
  if (stopping) return; stopping = true;
  server.closeAllConnections();
  await new Promise<void>(done => server.close(() => done()));
  await cleanup(); await release();
};
process.on('SIGTERM', () => { void stop(); });
process.on('SIGINT', () => { void stop(); });
