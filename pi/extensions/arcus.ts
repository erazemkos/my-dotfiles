import {
  getModels,
  getProviders,
  type AnthropicMessagesCompat,
  type Api,
  type Model,
} from "@earendil-works/pi-ai/compat";
import type {
  ExtensionAPI,
  ProviderModelConfig,
} from "@earendil-works/pi-coding-agent";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const PROVIDER_ID = "arcus";
const GATEWAY_URL = "https://ai-gateway.dev.devrev-eng.ai";
const OPENAI_BASE_URL = `${GATEWAY_URL}/v1`;
const KEYCHAIN_SERVICE = "arcus-token";
const KEYCHAIN_ACCOUNT = "devrev";
const API_KEY_CONFIG = `!security find-generic-password -s ${KEYCHAIN_SERVICE} -a ${KEYCHAIN_ACCOUNT} -w`;

// Available before authentication and used when gateway discovery is offline.
const FALLBACK_MODEL_IDS = [
  "anthropic.claude-opus-5",
  "anthropic.claude-sonnet-4-6",
  "anthropic.claude-opus-4-8",
  "anthropic.claude-haiku-4-5-20251001-v1:0",
  "gpt-5.6-sol",
  "gpt-5.6-terra",
  "gpt-5.6-luna",
];

const BUILTIN_MODELS = getProviders().flatMap((provider) =>
  getModels(provider),
) as Model<Api>[];

function normalizeGatewayModelId(id: string): string {
  return id.trim().replace(/^openai[./](?=gpt-)/, "");
}

function canonicalModelId(id: string): string {
  return normalizeGatewayModelId(id)
    .replace(/\[1m\]$/, "")
    .replace(/^(?:global|us|eu|apac|au|jp)\./, "")
    .replace(/^(?:anthropic|openai)[./]/, "")
    .replace(/-v\d+(?::\d+)?$/, "");
}

function isClaudeModel(id: string): boolean {
  return canonicalModelId(id).startsWith("claude-");
}

function findBuiltinMetadata(id: string): Model<Api> | undefined {
  const normalized = id.replace(/\[1m\]$/, "");
  const canonical = canonicalModelId(id);
  const preferredProvider = isClaudeModel(id)
    ? "anthropic"
    : canonical.startsWith("gpt-")
      ? "openai"
      : undefined;

  return (
    BUILTIN_MODELS.find(
      (model) => model.provider === "amazon-bedrock" && model.id === normalized,
    ) ??
    BUILTIN_MODELS.find((model) => model.id === normalized) ??
    BUILTIN_MODELS.find(
      (model) => model.provider === preferredProvider && model.id === canonical,
    ) ??
    BUILTIN_MODELS.find((model) => canonicalModelId(model.id) === canonical)
  );
}

function findProtocolMetadata(id: string): Model<Api> | undefined {
  const canonical = canonicalModelId(id);
  const provider = isClaudeModel(id)
    ? "anthropic"
    : canonical.startsWith("gpt-")
      ? "openai"
      : undefined;
  return BUILTIN_MODELS.find(
    (model) => model.provider === provider && model.id === canonical,
  );
}

function inferReasoning(id: string): boolean {
  return /claude|(?:^|[.-])gpt-5|reason|thinking|deepseek[.-]r1|qwen3|kimi/i.test(
    id,
  );
}

function inferImageInput(id: string): boolean {
  return /claude|gpt|gemini|grok|vision|pixtral|(?:^|[.-])vl(?:[.-]|$)/i.test(
    id,
  );
}

function supportsClaudeToolReferences(id: string): boolean {
  const canonical = canonicalModelId(id);
  if (canonical.includes("haiku")) return false;
  return /claude-(?:sonnet|opus|fable)-(?:4-[5-9]|[5-9])/.test(canonical);
}

function formatTokenCount(tokens: number): string {
  if (tokens >= 1_000_000) {
    const millions = tokens / 1_000_000;
    return `${Number.isInteger(millions) ? millions : millions.toFixed(1)}M`;
  }
  return `${Math.round(tokens / 1_000)}K`;
}

function routeLabel(id: string): string | undefined {
  if (id.endsWith("[1m]")) return "1M variant";
  if (id.startsWith("baseten/")) return "Baseten route";
  return undefined;
}

function toArcusModel(id: string): ProviderModelConfig {
  const metadata = findBuiltinMetadata(id);
  const claude = isClaudeModel(id);
  const reasoning = metadata?.reasoning ?? inferReasoning(id);
  const contextWindow = id.endsWith("[1m]")
    ? 1_000_000
    : (metadata?.contextWindow ?? 128_000);
  const maxTokens = metadata?.maxTokens ?? 16_384;
  const metadataCompat = (findProtocolMetadata(id)?.compat ??
    {}) as AnthropicMessagesCompat;

  const compat: Model<Api>["compat"] = claude
    ? {
        supportsEagerToolInputStreaming: false,
        forceAdaptiveThinking: metadataCompat.forceAdaptiveThinking,
        supportsTemperature: metadataCompat.supportsTemperature,
        supportsToolReferences: supportsClaudeToolReferences(id),
      }
    : {
        supportsDeveloperRole: canonicalModelId(id).startsWith("gpt-"),
        supportsReasoningEffort: reasoning,
        supportsUsageInStreaming: true,
        maxTokensField: canonicalModelId(id).startsWith("gpt-")
          ? "max_completion_tokens"
          : "max_tokens",
      };

  return {
    id,
    name: [
      metadata?.name ?? id,
      routeLabel(id),
      `${formatTokenCount(contextWindow)} context`,
      `${formatTokenCount(maxTokens)} max output`,
      reasoning ? "thinking" : "no thinking",
    ]
      .filter(Boolean)
      .join(" · "),
    api: claude ? "anthropic-messages" : "openai-completions",
    baseUrl: claude ? GATEWAY_URL : OPENAI_BASE_URL,
    reasoning,
    thinkingLevelMap: metadata?.thinkingLevelMap,
    input:
      metadata?.input ?? (inferImageInput(id) ? ["text", "image"] : ["text"]),
    cost: metadata?.cost ?? {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
    },
    contextWindow,
    maxTokens,
    compat,
  };
}

const execFileAsync = promisify(execFile);

async function keychainToken(signal?: AbortSignal): Promise<string> {
  const { stdout } = await execFileAsync(
    "security",
    [
      "find-generic-password",
      "-s",
      KEYCHAIN_SERVICE,
      "-a",
      KEYCHAIN_ACCOUNT,
      "-w",
    ],
    { signal, timeout: 5_000 },
  );
  const token = stdout.trim();
  if (!token) {
    throw new Error(
      `Arcus token missing from macOS Keychain (${KEYCHAIN_SERVICE}/${KEYCHAIN_ACCOUNT})`,
    );
  }
  return token;
}

async function discoverModels(
  token: string,
  signal?: AbortSignal,
): Promise<ProviderModelConfig[]> {
  const response = await fetch(`${GATEWAY_URL}/v1/models?limit=1000`, {
    headers: { Authorization: `Bearer ${token}` },
    signal,
  });
  if (!response.ok) {
    throw new Error(`Arcus model discovery failed: HTTP ${response.status}`);
  }

  const payload = (await response.json()) as { data?: Array<{ id?: unknown }> };
  const ids = [
    ...new Set(
      (payload.data ?? [])
        .map((entry) =>
          typeof entry.id === "string" ? normalizeGatewayModelId(entry.id) : "",
        )
        .filter(Boolean),
    ),
  ].sort();
  if (ids.length === 0)
    throw new Error("Arcus model discovery returned no models");
  return ids.map(toArcusModel);
}

export default async function arcusProvider(pi: ExtensionAPI) {
  let knownModels = FALLBACK_MODEL_IDS.map(toArcusModel);
  let catalogSource = "fallback (keychain discovery unavailable)";

  // Pi starts providers from this list. Discover here, rather than waiting for
  // refreshModels, because normal startup may intentionally disallow network
  // refreshes. This makes full Arcus catalog available to /model and /scope.
  try {
    knownModels = await discoverModels(await keychainToken());
    catalogSource = "gateway discovery";
  } catch (error) {
    catalogSource = `fallback (${error instanceof Error ? error.message : String(error)})`;
  }
  let catalogCount = knownModels.length;

  pi.registerProvider(PROVIDER_ID, {
    name: "Arcus AI Gateway",
    baseUrl: GATEWAY_URL,
    apiKey: API_KEY_CONFIG,
    api: "openai-completions",
    models: knownModels,
    async refreshModels(context) {
      if (!context.allowNetwork) return knownModels;

      try {
        const token = await keychainToken(context.signal);
        knownModels = await discoverModels(token, context.signal);
        catalogSource = "gateway discovery";
        catalogCount = knownModels.length;
        return knownModels;
      } catch (error) {
        catalogSource = `retained catalog (${error instanceof Error ? error.message : String(error)})`;
        throw error;
      }
    },
  });

  pi.registerCommand("arcus-status", {
    description: "Show Arcus authentication and model-catalog status",
    handler: async (_args, ctx) => {
      const auth = await ctx.modelRegistry
        .getProviderAuth(PROVIDER_ID)
        .catch(() => undefined);
      ctx.ui.notify(
        `Arcus auth: ${auth?.source ?? `missing macOS Keychain item ${KEYCHAIN_SERVICE}/${KEYCHAIN_ACCOUNT}`}; models: ${catalogCount} from ${catalogSource}`,
        auth ? "info" : "warning",
      );
    },
  });
}
