import { request } from 'node:http';
import { ApiError } from './http.ts';

export function localRequest(socketPath: string, path: string, body?: unknown, signal?: AbortSignal) {
  return new Promise<import('node:http').IncomingMessage>((resolve, reject) => {
    const req = request({ socketPath, path, method: body === undefined ? 'GET' : 'POST', headers: { 'Content-Type': 'application/json' }, signal }, resolve);
    req.on('error', reject);
    req.end(body === undefined ? undefined : JSON.stringify(body));
  });
}
export async function localJson(socketPath: string, path: string) {
  const res = await localRequest(socketPath, path, undefined, AbortSignal.timeout(2000));
  let content = '';
  for await (const chunk of res) {
    content += chunk.toString();
    if (content.length > 64 * 1024) throw new ApiError(502, 'Invalid session metadata');
  }
  if (res.statusCode !== 200) throw new ApiError(503, 'Session unavailable');
  return JSON.parse(content);
}
export async function* lines(stream: AsyncIterable<Buffer>) {
  let pending = '';
  const decoder = new TextDecoder();
  for await (const chunk of stream) {
    pending += decoder.decode(chunk, { stream: true });
    if (pending.length > 4 * 1024 * 1024) throw new ApiError(502, 'Session frame too large');
    let end;
    while ((end = pending.indexOf('\n')) >= 0) {
      const line = pending.slice(0, end); pending = pending.slice(end + 1);
      if (line) yield JSON.parse(line);
    }
  }
  if (pending.trim()) throw new ApiError(502, 'Truncated session stream');
}
