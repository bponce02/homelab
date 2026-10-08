import { createModels, type Context, type Message, type Models, type Tool, type AssistantMessage, type Model, type Api } from '@earendil-works/pi-ai';
import { openaiCodexProvider } from '@earendil-works/pi-ai/providers/openai-codex';
import { ApiError, response, type Backend, type Body, type Delta } from './http.ts';
import { FileCredentials } from './credentials.ts';
import { nativeSearch } from './search.ts';

export function codexModels(directory: string) {
  const models = createModels({ credentials: new FileCredentials(directory) });
  models.setProvider(openaiCodexProvider());
  return models;
}
const emptyUsage = () => ({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } });
function content(value: unknown, images = true): any[] {
  if (typeof value === 'string') return [{ type: 'text', text: value }];
  if (value === null || value === undefined) return [];
  if (!Array.isArray(value)) throw new ApiError(400, 'Invalid message content');
  return value.map(part => {
    if (part?.type === 'text' && typeof part.text === 'string') return { type: 'text', text: part.text };
    if (images && part?.type === 'image_url' && typeof part.image_url?.url === 'string') {
      const match = /^data:(image\/(?:png|jpeg|webp|gif));base64,([A-Za-z0-9+/=\r\n]+)$/.exec(part.image_url.url);
      if (match) return { type: 'image', mimeType: match[1], data: match[2] };
      throw new ApiError(400, 'Images must be inline data URLs; remote URLs are not fetched');
    }
    throw new ApiError(400, 'Unsupported content block');
  });
}
export function toContext(body: Body, model: Model<Api>): Context {
  const messages: Message[] = [];
  const calls = new Map<string, string>();
  for (const item of body.messages) {
    if (!item || typeof item !== 'object') throw new ApiError(400, 'Invalid message');
    const timestamp = Date.now();
    if (item.role === 'system' || item.role === 'developer') {
      messages.push({ role: 'system', content: content(item.content, false), timestamp });
    } else if (item.role === 'user') {
      messages.push({ role: 'user', content: content(item.content), timestamp });
    } else if (item.role === 'assistant') {
      const blocks = content(item.content, false);
      if (item.tool_calls !== undefined && !Array.isArray(item.tool_calls)) throw new ApiError(400, 'Invalid tool calls');
      for (const call of item.tool_calls ?? []) {
        if (call?.type !== 'function' || typeof call.id !== 'string' || typeof call.function?.name !== 'string') throw new ApiError(400, 'Invalid function call');
        let args;
        try { args = JSON.parse(call.function.arguments); } catch { throw new ApiError(400, 'Invalid function arguments JSON'); }
        if (!args || typeof args !== 'object' || Array.isArray(args)) throw new ApiError(400, 'Function arguments must be an object');
        if (calls.has(call.id)) throw new ApiError(400, 'Duplicate tool call ID');
        calls.set(call.id, call.function.name);
        blocks.push({ type: 'toolCall', id: call.id, name: call.function.name, arguments: args });
      }
      messages.push({ role: 'assistant', content: blocks, api: model.api, provider: model.provider, model: model.id, usage: emptyUsage(), stopReason: item.tool_calls?.length ? 'toolUse' : 'stop', timestamp });
    } else if (item.role === 'tool') {
      const name = calls.get(item.tool_call_id);
      if (!name) throw new ApiError(400, 'Tool result has no preceding call');
      messages.push({ role: 'toolResult', toolCallId: item.tool_call_id, toolName: name, content: content(item.content), isError: false, timestamp });
    } else throw new ApiError(400, 'Unsupported message role');
  }
  if (body.tools !== undefined && !Array.isArray(body.tools)) throw new ApiError(400, 'tools must be an array');
  nativeSearch(body.tools);
  const tools: Tool[] = (body.tools ?? []).filter((tool: any) => tool?.type !== 'web_search').map((tool: any) => {
    if (tool?.type !== 'function' || typeof tool.function?.name !== 'string' || tool.function.parameters?.type !== 'object') throw new ApiError(400, 'Only function tools with object schemas are supported');
    return { name: tool.function.name, description: tool.function.description ?? '', parameters: tool.function.parameters };
  });
  return { messages, tools };
}
function completion(body: Body, answer: AssistantMessage) {
  const tool_calls = answer.content.filter(b => b.type === 'toolCall').map(b => ({ id: b.id, type: 'function', function: { name: b.name, arguments: JSON.stringify(b.arguments) } }));
  const text = answer.content.filter(b => b.type === 'text').map(b => b.text).join('');
  const reasoning = answer.content.filter(b => b.type === 'thinking').map(b => b.thinking).join('');
  const usage = { prompt_tokens: answer.usage.input + answer.usage.cacheRead + answer.usage.cacheWrite, completion_tokens: answer.usage.output, total_tokens: answer.usage.totalTokens };
  return response(body.model, { content: text || null, ...(reasoning ? { reasoning_content: reasoning } : {}), ...(tool_calls.length ? { tool_calls } : {}) }, answer.stopReason === 'toolUse' ? 'tool_calls' : answer.stopReason === 'length' ? 'length' : 'stop', usage);
}
export class CodexBackend implements Backend {
  constructor(private models: Models, private provider = 'openai-codex') {}
  async list() { return this.models.getModels(this.provider).map(m => ({ id: m.id, name: m.name })); }
  async complete(body: Body, emit: (delta: Delta) => void, signal: AbortSignal) {
    const model = this.models.getModel(this.provider, body.model);
    if (!model) throw new ApiError(404, 'Unknown model');
    for (const field of ['response_format', 'stop', 'logprobs', 'top_logprobs', 'functions', 'function_call', 'top_p', 'presence_penalty', 'frequency_penalty', 'seed']) {
      if (body[field] != null) throw new ApiError(400, `${field} is not supported`);
    }
    if (body.tool_choice != null && !['auto', 'none', 'required'].includes(body.tool_choice)) throw new ApiError(400, 'Only auto/none/required tool_choice is supported');
    const context = toContext(body, model);
    if (body.reasoning_effort !== undefined && !['minimal', 'low', 'medium', 'high', 'xhigh', 'max'].includes(body.reasoning_effort)) throw new ApiError(400, 'Invalid reasoning_effort');
    const maxTokens = body.max_completion_tokens ?? body.max_tokens;
    if (maxTokens !== undefined && (!Number.isInteger(maxTokens) || maxTokens <= 0)) throw new ApiError(400, 'Invalid token limit');
    if (body.temperature !== undefined && (typeof body.temperature !== 'number' || body.temperature < 0 || body.temperature > 2)) throw new ApiError(400, 'Invalid temperature');
    const search = nativeSearch(body.tools);
    const stream = this.models.streamSimple(model, context, { signal, transport: 'sse', ...(search ? { onPayload: search.onPayload, onProviderStreamEvent: search.onProviderStreamEvent } : {}), toolChoice: body.tool_choice, temperature: body.temperature, ...(maxTokens ? { maxTokens } : {}), ...(body.reasoning_effort ? { reasoning: body.reasoning_effort } : {}) });
    let toolIndex = 0;
    for await (const event of stream) {
      if (event.type === 'text_delta') emit({ content: event.delta });
      if (event.type === 'thinking_delta') emit({ reasoning_content: event.delta });
      if (event.type === 'toolcall_end') emit({ tool_calls: [{ index: toolIndex++, id: event.toolCall.id, type: 'function', function: { name: event.toolCall.name, arguments: JSON.stringify(event.toolCall.arguments) } }] });
      if (event.type === 'error') throw new ApiError(event.reason === 'aborted' ? 504 : 502, 'Codex request failed or was cancelled; check OAuth login, model access, and quota');
    }
    const answer = await stream.result();
    if (answer.stopReason === 'error' || answer.stopReason === 'aborted') throw new ApiError(502, 'Codex did not finish successfully');
    const result = completion(body, answer);
    if (search) {
      const metadata = search.result();
      if (body.tool_choice === 'required' && !metadata.performed) throw new ApiError(502, 'Native Codex search did not run');
      result.choices[0].message.native_search = metadata;
    }
    return result;
  }
}
