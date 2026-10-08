import { ApiError, type Body } from './http.ts';
import { patchProviderPayload } from './native.ts';

export interface SearchSource { title: string; url: string }
function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}
export function nativeSearch(tools: Body[] = []) {
  const selected = tools.filter(tool => tool?.type === 'web_search');
  if (!selected.length) return undefined;
  if (selected.length !== 1 || Object.keys(selected[0]).some(key => !['type', 'external_web_access'].includes(key)) || (selected[0].external_web_access !== undefined && typeof selected[0].external_web_access !== 'boolean')) throw new ApiError(400, 'Invalid native web search declaration');
  const sources = new Map<string, SearchSource>();
  let performed = false;
  const add = (value: unknown) => {
    const source = record(value);
    if (typeof source?.url !== 'string' || source.url.length > 2048) return;
    let url: URL;
    try { url = new URL(source.url); } catch { return; }
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return;
    if (url.searchParams.get('utm_source') === 'openai') url.searchParams.delete('utm_source');
    const key = url.toString();
    if (!sources.has(key) && sources.size >= 20) return;
    sources.set(key, { url: key, title: typeof source.title === 'string' && source.title.trim() ? source.title.trim().slice(0, 300) : sources.get(key)?.title ?? url.hostname });
  };
  const item = (value: unknown) => {
    const output = record(value);
    if (output?.type === 'web_search_call') {
      if (output.status === 'completed') performed = true;
      const action = record(output.action);
      if (Array.isArray(action?.sources)) action.sources.forEach(add);
    }
    if (output?.type === 'message' && Array.isArray(output.content)) {
      for (const part of output.content) {
        const content = record(part);
        if (Array.isArray(content?.annotations)) content.annotations.filter(a => record(a)?.type === 'url_citation').forEach(add);
      }
    }
  };
  return {
    onPayload(payload: unknown): Record<string, unknown> {
      const patched = patchProviderPayload(payload, { mode: selected[0].external_web_access === false ? 'cached' : 'live' });
      if (!patched) throw new ApiError(502, 'Unable to declare native Codex search');
      return { ...patched, include: [...(Array.isArray(patched.include) ? patched.include : []), 'web_search_call.action.sources'] };
    },
    onProviderStreamEvent(value: unknown) {
      const event = record(value);
      if (event?.type === 'response.output_text.annotation.added' && record(event.annotation)?.type === 'url_citation') add(event.annotation);
      if (['response.output_item.added', 'response.output_item.done'].includes(String(event?.type))) item(event?.item);
      if (['response.completed', 'response.done'].includes(String(event?.type))) {
        const response = record(event?.response);
        if (Array.isArray(response?.output)) response.output.forEach(item);
      }
    },
    result: () => ({ performed, sources: [...sources.values()] }),
  };
}
