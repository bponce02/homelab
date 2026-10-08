export interface WebSearchConfig {
  mode: 'live' | 'cached';
  allowedDomains?: string[];
  contextSize?: 'low' | 'medium' | 'high';
  location?: { country?: string; region?: string; city?: string; timezone?: string };
}

type ProviderPayload = Record<string, unknown>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isCodexModel(
  model: { provider: string; api?: string } | undefined,
): boolean {
  if (!model) return false;
  if (model.provider === "openai-codex") return true;
  if (model.api === "openai-codex-responses") return true;
  return false;
}

export function hasWebSearchTool(tools: unknown): boolean {
  if (!Array.isArray(tools)) return false;

  return tools.some((tool) => {
    if (!isRecord(tool)) return false;
    return typeof tool.type === "string" && tool.type.startsWith("web_search");
  });
}

export function buildWebSearchTool(
  config: WebSearchConfig,
): Record<string, unknown> {
  const tool: Record<string, unknown> = {
    type: "web_search",
    external_web_access: config.mode === "live",
  };

  if (config.allowedDomains !== undefined) {
    tool.filters = {
      allowed_domains: config.allowedDomains,
    };
  }

  if (config.contextSize) {
    tool.search_context_size = config.contextSize;
  }

  if (config.location) {
    tool.user_location = {
      type: "approximate",
      ...config.location,
    };
  }

  return tool;
}

export function patchProviderPayload(
  payload: unknown,
  config: WebSearchConfig,
): ProviderPayload | undefined {
  if (!isRecord(payload)) return undefined;
  const typedPayload = payload as ProviderPayload;
  if (hasWebSearchTool(typedPayload.tools)) return undefined;

  const tools = Array.isArray(typedPayload.tools)
    ? [...typedPayload.tools]
    : [];
  tools.push(buildWebSearchTool(config));

  return {
    ...typedPayload,
    tools,
  };
}
