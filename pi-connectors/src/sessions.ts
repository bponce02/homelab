import { readFileSync, readdirSync, mkdirSync, chmodSync } from 'node:fs';
import { basename, join } from 'node:path';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { DatabaseSync } from 'node:sqlite';
import { ApiError, response, type Backend, type Body, type Delta } from './http.ts';
import { localJson, localRequest, lines } from './session-protocol.ts';
import { remoteTurn } from './session-history.ts';

export type AllowedSession = { id: string; name: string; sessionId: string };
export async function verifyHerdr(meta: Body) {
  const { stdout } = await promisify(execFile)(process.env.HERDR_BIN ?? 'herdr', ['agent', 'get', meta.paneId], {
    timeout: 3000, maxBuffer: 128 * 1024,
    env: { ...process.env, HERDR_ENV: '1', HERDR_SOCKET_PATH: meta.herdrSocket },
  });
  const agent = JSON.parse(stdout).result?.agent;
  if (agent?.agent !== 'pi' || agent.pane_id !== meta.paneId || agent.agent_session?.value !== meta.sessionFile) throw new ApiError(409, 'Herdr pane no longer contains this Pi session');
  return agent as Body;
}
const hash = (text: string) => createHash('sha256').update(text).digest('hex');
export class SessionBackend implements Backend {
  private db: DatabaseSync;
  constructor(private config: string, private runtime: string, state: string, private verify: (meta: Body) => Promise<Body | void> = verifyHerdr) {
    mkdirSync(state, { recursive: true, mode: 0o700 }); chmodSync(state, 0o700);
    this.db = new DatabaseSync(join(state, 'requests.sqlite'));
    this.db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; CREATE TABLE IF NOT EXISTS requests (id TEXT PRIMARY KEY, fingerprint TEXT NOT NULL, status TEXT NOT NULL, result TEXT); UPDATE requests SET status=\'indeterminate\' WHERE status=\'pending\';');
  }
  close() { this.db.close(); }
  private async allowed(): Promise<AllowedSession[]> {
    const config = JSON.parse(readFileSync(this.config, 'utf8'));
    const values: AllowedSession[] = config.sessions ?? [];
    if (!Array.isArray(values)) throw new ApiError(503, 'Invalid session allowlist');
    const ids = new Set();
    for (const value of values) {
      if (!/^[a-zA-Z0-9_-]{1,48}$/.test(value.id) || !/^[a-zA-Z0-9-]{1,64}$/.test(value.sessionId) || typeof value.name !== 'string' || ids.has(value.id)) throw new ApiError(503, 'Invalid session allowlist');
      ids.add(value.id);
    }
    if (config.discovery === 'all') {
      let files: string[];
      try { files = readdirSync(this.runtime); }
      catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return values; throw error; }
      const sessions = new Set(values.map(value => value.sessionId));
      for (const file of files.sort()) {
        if (!/^[a-zA-Z0-9-]{1,64}\.json$/.test(file)) continue;
        const sessionId = file.slice(0, -5);
        if (sessions.has(sessionId)) continue;
        try {
          const meta = JSON.parse(readFileSync(join(this.runtime, file), 'utf8'));
          if (meta.sessionId !== sessionId) continue;
          const agent = await this.verify(meta);
          const project = agent?.cwd ? basename(agent.cwd) : 'session';
          const slug = project.replace(/[^a-zA-Z0-9_-]+/g, '-').slice(0, 48) || 'session';
          const id = `${slug}-${hash(sessionId).slice(0, 12)}`;
          if (ids.has(id)) continue;
          values.push({ id, name: `${project} · ${sessionId.slice(-8)}`, sessionId });
          ids.add(id);
        } catch { /* Ignore stale or invalid registrations. */ }
      }
    }
    return values;
  }
  private async target(item: AllowedSession) {
    const meta = JSON.parse(readFileSync(join(this.runtime, `${item.sessionId}.json`), 'utf8'));
    if (meta.sessionId !== item.sessionId || typeof meta.paneId !== 'string' || typeof meta.herdrSocket !== 'string' || typeof meta.sessionFile !== 'string') throw new ApiError(503, 'Invalid local registration');
    await this.verify(meta);
    const socket = join(this.runtime, `${item.sessionId}.sock`);
    const status = await localJson(socket, '/status');
    if (status.sessionId !== item.sessionId || status.nonce !== meta.nonce) throw new ApiError(409, 'Session identity changed');
    return { meta, socket, status };
  }
  async list() {
    const models: Array<{ id: string; name: string }> = [];
    for (const item of await this.allowed()) {
      try { const { status } = await this.target(item); models.push({ id: `pi/${item.id}`, name: `${item.name}${status.busy ? ' (busy)' : ''}` }); }
      catch { /* Offline registrations are not models. */ }
    }
    return models;
  }
  async *snapshots() {
    for (const item of await this.allowed()) {
      try {
        const { socket, meta, status } = await this.target(item);
        if (status.busy) continue;
        const history = await localJson(socket, '/history', 2 * 1024 * 1024);
        if (history.sessionId !== item.sessionId || history.nonce !== meta.nonce) continue;
        yield { ...history, nonce: undefined, model: `pi/session-${item.sessionId}` };
      } catch { /* Busy, old, or offline bridges are retried on the next poll. */ }
    }
  }
  async complete(body: Body, emit: (delta: Delta) => void, signal: AbortSignal, key?: string) {
    if ((body.tools?.length ?? 0) || body.functions || body.tool_choice && body.tool_choice !== 'none') throw new ApiError(400, 'Local Pi runs its own tools; disable LibreChat agent tools for this endpoint');
    const last = body.messages.at(-1);
    if (last?.role !== 'user' || typeof last.content !== 'string' || !last.content.trim()) throw new ApiError(400, 'Local Pi accepts a final text-only user message');
    if (last.content.length > 128 * 1024 || /^[!/]/.test(last.content.trimStart())) throw new ApiError(400, 'Prompt too large or a CLI command');
    const item = (await this.allowed()).find(s => `pi/${s.id}` === body.model || `pi/session-${s.sessionId}` === body.model);
    if (!item) throw new ApiError(404, 'Session is not available');
    const remote = remoteTurn(body._piRemote);
    const fingerprint = hash(JSON.stringify([item.sessionId, body.messages, remote]));
    const id = hash(item.sessionId + ':' + (remote ? `${remote.conversationId}:${remote.userMessageId}` : key ?? fingerprint));
    const existing = this.db.prepare('SELECT * FROM requests WHERE id=?').get(id) as Body | undefined;
    if (existing) {
      if (existing.fingerprint !== fingerprint) throw new ApiError(409, 'Idempotency key reused for different input');
      if (existing.status !== 'done') throw new ApiError(409, 'Request was already submitted or interrupted; inspect Pi before sending new work');
      const cached = JSON.parse(existing.result); emit({ content: cached.choices[0].message.content }); return cached;
    }
    let target;
    try { target = await this.target(item); }
    catch (error) { if (error instanceof ApiError) throw error; throw new ApiError(503, 'Local Pi session is offline'); }
    if (target.status.busy) throw new ApiError(409, 'Pi is busy; wait until it settles');
    signal.throwIfAborted();
    try { this.db.prepare('INSERT INTO requests VALUES (?, ?, \'pending\', NULL)').run(id, fingerprint); }
    catch { throw new ApiError(409, 'Request is already in progress'); }
    try {
      const result = await localRequest(target.socket, '/prompt', { id, sessionId: item.sessionId, nonce: target.meta.nonce, prompt: last.content, ...(remote && { remote }) }, signal);
      if (result.statusCode !== 200) {
        let message = ''; for await (const chunk of result) { message += chunk.toString(); if (message.length > 65536) break; }
        if (message.includes('Pi is busy')) this.db.prepare('DELETE FROM requests WHERE id=?').run(id);
        throw new ApiError(result.statusCode === 409 ? 409 : 502, 'Pi rejected the request; check its status before retrying');
      }
      let answer: string | undefined;
      for await (const frame of lines(result)) {
        if (frame.type === 'delta' && typeof frame.text === 'string') emit({ content: frame.text });
        else if (frame.type === 'done' && typeof frame.text === 'string') answer = frame.text;
        else if (frame.type === 'error') throw new ApiError(502, 'Pi stopped or failed; inspect the local transcript');
      }
      if (answer === undefined) throw new ApiError(502, 'Pi disconnected before completion; request will not be resubmitted');
      const completed = response(body.model, { content: answer });
      this.db.prepare('UPDATE requests SET status=\'done\', result=? WHERE id=?').run(JSON.stringify(completed), id);
      return completed;
    } catch (error) {
      this.db.prepare('UPDATE requests SET status=\'indeterminate\' WHERE id=?').run(id);
      if (error instanceof ApiError) throw error;
      throw new ApiError(502, 'Connection lost; Pi may still be working. Inspect the CLI before retrying');
    }
  }
}
