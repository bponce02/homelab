import { createServer, type Server, type ServerResponse } from 'node:http';
import { mkdir, writeFile, unlink, chmod } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { randomUUID } from 'node:crypto';
import type { ExtensionAPI, ExtensionContext } from '@earendil-works/pi-coding-agent';
import { readJson, json, ApiError } from '../src/http.ts';

export default function (pi: ExtensionAPI) {
  let server: Server | undefined;
  let metadata: string | undefined;
  let socket: string | undefined;
  let ctx: ExtensionContext;
  let active: { id: string; res: ServerResponse; text: string; messageText: string; failure?: string; modelFailed?: boolean } | undefined;
  const seen = new Set<string>();
  const emit = (event: object) => {
    if (active && !active.res.destroyed) {
      if (active.res.writableLength > 1024 * 1024) { active.res.destroy(); return; }
      active.res.write(JSON.stringify(event) + '\n');
    }
  };
  const text = (delta: string) => {
    if (!active) return;
    if (active.text.length + delta.length > 2 * 1024 * 1024) {
      active.failure = 'Pi response exceeded gateway limit; view the CLI transcript'; return;
    }
    active.text += delta; active.messageText += delta;
    emit({ type: 'delta', text: delta });
  };
  const close = async () => {
    if (active) { emit({ type: 'error', message: 'Pi session closed or switched; inspect the CLI before retrying' }); active.res.end(); active = undefined; }
    const listener = server;
    const paths = [metadata, socket];
    server = undefined; metadata = socket = undefined;
    if (listener) { listener.closeAllConnections(); await new Promise<void>(resolve => listener.close(() => resolve())); }
    for (const path of paths) if (path) await unlink(path).catch(() => {});
  };
  pi.on('session_start', async (_event, context) => {
    await close(); ctx = context;
    const root = process.env.PI_SESSION_BRIDGE_DIR ?? join(homedir(), '.local/state/pi-gateway/run');
    if (process.env.HERDR_ENV !== '1' || !process.env.HERDR_PANE_ID || !process.env.HERDR_SOCKET_PATH) return;
    const id = ctx.sessionManager.getSessionId();
    if (!/^[a-zA-Z0-9-]{1,64}$/.test(id)) throw new Error('Unsupported session ID');
    await mkdir(root, { recursive: true, mode: 0o700 }); await chmod(root, 0o700);
    const target = join(root, `${id}.sock`);
    const registration = join(root, `${id}.json`);
    const nonce = randomUUID();
    seen.clear();
    for (const entry of ctx.sessionManager.getEntries()) {
      if (entry.type === 'custom' && entry.customType === 'pi-gateway-request' && typeof (entry.data as any)?.id === 'string') seen.add((entry.data as any).id);
    }
    const listener = createServer(async (req, res) => {
      try {
        if (req.method === 'GET' && req.url === '/status') { json(res, 200, { sessionId: id, nonce, busy: !!active || !ctx.isIdle() }); return; }
        if (req.method !== 'POST' || req.url !== '/prompt') throw new ApiError(404, 'Not found');
        const body = await readJson(req, 256 * 1024);
        if (body.nonce !== nonce || body.sessionId !== ctx.sessionManager.getSessionId()) throw new ApiError(409, 'Session identity changed');
        if (typeof body.id !== 'string' || !/^[a-f0-9]{64}$/.test(body.id) || typeof body.prompt !== 'string' || !body.prompt.trim()) throw new ApiError(400, 'Invalid prompt');
        if (/^[!/]/.test(body.prompt.trimStart())) throw new ApiError(400, 'CLI commands are not accepted remotely');
        if (seen.has(body.id)) throw new ApiError(409, 'Request already submitted; inspect the Pi transcript');
        if (active || !ctx.isIdle() || ctx.hasPendingMessages()) throw new ApiError(409, 'Pi is busy; wait until it settles');
        seen.add(body.id);
        pi.appendEntry('pi-gateway-request', { id: body.id });
        active = { id: body.id, res, text: '', messageText: '' };
        res.writeHead(200, { 'Content-Type': 'application/x-ndjson' });
        res.flushHeaders();
        try { pi.sendUserMessage(body.prompt); }
        catch { active.failure = 'Pi rejected the prompt; inspect the CLI'; emit({ type: 'error', message: active.failure }); res.end(); active = undefined; }
      } catch (error) {
        if (!res.headersSent) json(res, error instanceof ApiError ? error.status : 500, { error: error instanceof ApiError ? error.message : 'Session bridge failed' });
        else res.end();
      }
    });
    try {
      await new Promise<void>((resolve, reject) => { listener.once('error', reject); listener.listen(target, resolve); });
      server = listener; socket = target;
      await chmod(target, 0o600);
      await writeFile(registration, JSON.stringify({ sessionId: id, sessionFile: ctx.sessionManager.getSessionFile(), paneId: process.env.HERDR_PANE_ID, herdrSocket: process.env.HERDR_SOCKET_PATH, nonce }), { mode: 0o600, flag: 'wx' });
      metadata = registration;
    } catch (error) { await close(); throw error; }
  });
  pi.on('input', (event, context) => {
    if (active && event.source === 'interactive') {
      if (context.hasUI) { context.ui.setEditorText(event.text); context.ui.notify('Remote request is running. Wait, or interrupt with Esc before sending another prompt.', 'warning'); }
      return { action: 'handled' };
    }
  });
  pi.on('message_start', event => {
    if (active && event.message.role === 'assistant') { if (active.text) text('\n\n'); active.messageText = ''; }
  });
  pi.on('message_update', event => {
    if (event.assistantMessageEvent.type === 'text_delta') text(event.assistantMessageEvent.delta);
  });
  pi.on('message_end', event => {
    if (!active || event.message.role !== 'assistant') return;
    if (!active.messageText) text(event.message.content.filter(b => b.type === 'text').map(b => b.text).join(''));
    active.modelFailed = event.message.stopReason === 'error' || event.message.stopReason === 'aborted';
  });
  pi.on('agent_settled', () => {
    if (!active) return;
    const failure = active.failure ?? (active.modelFailed ? 'Pi run failed or was interrupted; inspect the CLI transcript' : undefined);
    emit(failure ? { type: 'error', message: failure } : { type: 'done', text: active.text || 'Pi completed without a text reply.' });
    active.res.end(); active = undefined;
  });
  pi.on('session_shutdown', close);
}
