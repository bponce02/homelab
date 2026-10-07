import { timingSafeEqual, randomUUID } from 'node:crypto';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';

export class ApiError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
export type Body = Record<string, any>;
export type Delta = Record<string, unknown>;
export interface Backend {
  list(): Promise<Array<{ id: string; name: string }>>;
  complete(body: Body, emit: (delta: Delta) => void, signal: AbortSignal, key?: string): Promise<Body>;
}
export async function readJson(req: IncomingMessage, limit = 8 * 1024 * 1024): Promise<Body> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const part of req.iterator({ destroyOnReturn: false })) {
    size += part.length;
    if (size > limit) { req.resume(); throw new ApiError(413, 'Request too large'); }
    chunks.push(part);
  }
  let value;
  try { value = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw new ApiError(400, 'Invalid JSON'); }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ApiError(400, 'Expected JSON object');
  return value;
}
export function json(res: ServerResponse, status: number, value: unknown) {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(value));
}
export function failure(res: ServerResponse, error: unknown) {
  const status = error instanceof ApiError ? error.status : 502;
  const message = error instanceof ApiError ? error.message : 'Connector failed; inspect local service status';
  const payload = { error: { message, type: 'connector_error', code: String(status) } };
  if (res.headersSent) { if (!res.destroyed) res.end(`data: ${JSON.stringify(payload)}\n\ndata: [DONE]\n\n`); }
  else json(res, status, payload);
}
export function validate(body: Body) {
  if (typeof body.model !== 'string' || !Array.isArray(body.messages) || !body.messages.length) throw new ApiError(400, 'model and nonempty messages are required');
  if (body.stream !== undefined && typeof body.stream !== 'boolean') throw new ApiError(400, 'stream must be boolean');
  if (body.n !== undefined && body.n !== 1) throw new ApiError(400, 'Only n=1 is supported');
  if (body.tools !== undefined && !Array.isArray(body.tools)) throw new ApiError(400, 'tools must be an array');
}
export function response(model: string, message: Body, finish = 'stop', usage?: Body): Body {
  return { id: `chatcmpl-${randomUUID()}`, object: 'chat.completion', created: Math.floor(Date.now() / 1000), model,
    choices: [{ index: 0, message: { role: 'assistant', ...message }, finish_reason: finish }], ...(usage ? { usage } : {}) };
}
export function apiServer(backend: Backend, key: string, timeoutMs = 600_000) {
  if (key.length < 32) throw new Error('Client key must contain at least 32 characters');
  let active = 0;
  return createServer(async (req, res) => {
    if (active >= 16) { failure(res, new ApiError(503, 'Connector at capacity')); return; }
    active++;
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), timeoutMs);
    res.on('close', () => abort.abort());
    req.on('aborted', () => abort.abort());
    try {
      if (req.method === 'GET' && req.url === '/health') { json(res, 200, { status: 'ok' }); return; }
      const actual = Buffer.from(req.headers.authorization ?? '');
      const expected = Buffer.from(`Bearer ${key}`);
      if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) throw new ApiError(401, 'Invalid client key');
      if (req.headers.origin) throw new ApiError(403, 'Browser API access is disabled; connect server-to-server');
      if (req.method === 'GET' && req.url === '/v1/models') {
        json(res, 200, { object: 'list', data: (await backend.list()).map(m => ({ ...m, object: 'model', created: 0, owned_by: 'local-pi' })) }); return;
      }
      if (req.method !== 'POST' || req.url !== '/v1/chat/completions') throw new ApiError(404, 'Not found');
      const body = await readJson(req);
      validate(body);
      delete body._piRemote;
      const remoteHeader = req.headers['x-pi-turn'];
      if (typeof remoteHeader === 'string' && remoteHeader !== '{{LIBRECHAT_BODY_PITURN}}') {
        try { body._piRemote = JSON.parse(Buffer.from(remoteHeader, 'base64url').toString('utf8')); }
        catch { throw new ApiError(400, 'Invalid Pi turn header'); }
      }
      const id = `chatcmpl-${randomUUID()}`;
      const created = Math.floor(Date.now() / 1000);
      const send = (choices: unknown[], usage?: unknown) => {
        if (abort.signal.aborted) throw new ApiError(504, 'Request cancelled or timed out');
        if (!res.headersSent) res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', 'X-Accel-Buffering': 'no' });
        if (res.writableLength > 1024 * 1024) { abort.abort(); throw new ApiError(503, 'Client too slow'); }
        res.write(`data: ${JSON.stringify({ id, object: 'chat.completion.chunk', created, model: body.model, choices, ...(usage ? { usage } : {}) })}\n\n`);
      };
      let started = false;
      const emit = (delta: Delta) => {
        if (!body.stream) return;
        if (!started) { send([{ index: 0, delta: { role: 'assistant' }, finish_reason: null }]); started = true; }
        send([{ index: 0, delta, finish_reason: null }]);
      };
      const result = await backend.complete(body, emit, abort.signal, typeof req.headers['idempotency-key'] === 'string' ? req.headers['idempotency-key'] : undefined);
      if (abort.signal.aborted) throw new ApiError(504, 'Request cancelled or timed out');
      if (!body.stream) json(res, 200, result);
      else {
        if (!started) emit({ content: result.choices[0].message.content ?? '' });
        send([{ index: 0, delta: {}, finish_reason: result.choices[0].finish_reason }]);
        if (body.stream_options?.include_usage && result.usage) send([], result.usage);
        res.end('data: [DONE]\n\n');
      }
    } catch (error) { failure(res, error); }
    finally { clearTimeout(timer); active--; }
  });
}
