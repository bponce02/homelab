import { ApiError, type Body } from './http.ts';

export type RemoteTurn = { conversationId: string; userMessageId: string; responseMessageId: string; expectedLeaf?: string | null };
export type HistoryMessage = { entryId: string; role: 'user' | 'assistant'; text: string; timestamp: string; remote?: RemoteTurn };
export function remoteTurn(value: unknown): RemoteTurn | undefined {
  if (value === undefined) return undefined;
  const v = value as RemoteTurn;
  if (!v || !['conversationId', 'userMessageId', 'responseMessageId'].every(k => typeof (v as Body)[k] === 'string' && /^[a-zA-Z0-9_-]{1,128}$/.test((v as Body)[k]))) throw new ApiError(400, 'Invalid remote turn identity');
  if (v.expectedLeaf !== undefined && v.expectedLeaf !== null && (typeof v.expectedLeaf !== 'string' || !/^[a-zA-Z0-9-]{1,64}$/.test(v.expectedLeaf))) throw new ApiError(400, 'Invalid expected Pi leaf');
  return { conversationId: v.conversationId, userMessageId: v.userMessageId, responseMessageId: v.responseMessageId, ...(v.expectedLeaf !== undefined && { expectedLeaf: v.expectedLeaf }) };
}
export function historyMessages(entries: readonly Body[]): HistoryMessage[] {
  const result: HistoryMessage[] = [];
  let remote: RemoteTurn | undefined;
  let nextRemote: RemoteTurn | undefined;
  for (const entry of entries) {
    if (entry.type === 'custom' && entry.customType === 'pi-gateway-request') {
      nextRemote = remoteTurn(entry.data?.remote);
      continue;
    }
    if (entry.type !== 'message') continue;
    const { role, content } = entry.message;
    if (role !== 'user' && role !== 'assistant') continue;
    if (role === 'user') { remote = nextRemote; nextRemote = undefined; }
    const visibleText = typeof content === 'string' ? content : (content ?? []).filter((part: Body) => part.type === 'text' && typeof part.text === 'string').map((part: Body) => part.text).join('');
    const text = visibleText || (role === 'user' ? '[Non-text user message omitted]' : '');
    if (!text) continue;
    const previous = result.at(-1);
    if (role === 'assistant' && previous?.role === 'assistant') previous.text += '\n\n' + text;
    else result.push({ entryId: entry.id, role, text, timestamp: entry.timestamp, ...(remote && { remote }) });
  }
  return result;
}
