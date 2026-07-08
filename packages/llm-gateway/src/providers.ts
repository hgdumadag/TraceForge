/** Provider adapters: ollama (default, local), openai, azure_foundry (cloud, opt-in), mock (tests). */
import type {
  LlmProvider,
  LlmChatRequest,
  LlmChatResponse,
  LlmStreamEvent,
  EmbeddingRequest,
  EmbeddingResponse,
  ProviderConfig
} from "./types.js";
import { LlmProviderError } from "./types.js";

const DEFAULT_TIMEOUT = 60000;

async function fetchJson(
  url: string,
  init: RequestInit,
  timeoutMs: number,
  providerId: string
): Promise<any> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...init, signal: controller.signal });
    if (!res.ok) {
      // Do not leak response bodies that may echo credentials.
      throw new LlmProviderError(`Provider request failed with status ${res.status}.`, providerId, res.status);
    }
    return await res.json();
  } catch (e) {
    if (e instanceof LlmProviderError) throw e;
    const msg = e instanceof Error && e.name === "AbortError" ? "Provider request timed out." : "Provider is unreachable.";
    throw new LlmProviderError(msg, providerId);
  } finally {
    clearTimeout(timer);
  }
}

// --- Health checks ----------------------------------------------------------
// "Check" sends a real one-line test prompt so a green result means the model
// actually responds — not merely that settings are filled in. The prompt contains
// no user data; for cloud providers the user's click on Check is the explicit
// opt-in required by project.md §8.5.

const HEALTH_PROMPT: LlmChatRequest = {
  messages: [{ role: "user", content: "Reply with only the word OK." }],
  maxTokens: 10
};

async function testChat(provider: LlmProvider): Promise<{ ok: true; detail: string }> {
  const start = Date.now();
  const res = await provider.chat(HEALTH_PROMPT);
  return { ok: true, detail: `Model ${res.model} responded in ${Date.now() - start}ms.` };
}

/** Map a failed test call to guidance the user can act on. Status codes are safe
 * to interpret; response bodies are never read (they may echo credentials). */
function healthFailure(
  e: unknown,
  ctx: { auth: string; notFound: string; reach: string }
): { ok: false; detail: string } {
  const status = e instanceof LlmProviderError ? e.status : undefined;
  if (status === 401 || status === 403) {
    return { ok: false, detail: `Authentication failed (${status}). ${ctx.auth}` };
  }
  if (status === 404) return { ok: false, detail: `Not found (404). ${ctx.notFound}` };
  if (status === 429) {
    return { ok: false, detail: "Rate limited or out of quota (429). Wait and retry, or review your plan and quota." };
  }
  if (status && status >= 500) {
    return { ok: false, detail: `The provider returned a server error (${status}). The service is having problems — try again later.` };
  }
  const base = e instanceof Error ? e.message : "Request failed.";
  return { ok: false, detail: `${base} ${ctx.reach}` };
}

// ---------------------------------------------------------------------------

export class OllamaProvider implements LlmProvider {
  readonly type = "ollama" as const;
  readonly kind = "local" as const;
  id: string;
  displayName: string;
  private baseUrl: string;
  private model: string;
  private timeoutMs: number;

  constructor(cfg: ProviderConfig) {
    this.id = cfg.id;
    this.displayName = cfg.displayName || "Ollama (local)";
    this.baseUrl = (cfg.baseUrl ?? "http://127.0.0.1:11434").replace(/\/$/, "");
    this.model = cfg.model ?? "llama3.1";
    this.timeoutMs = cfg.timeoutMs ?? DEFAULT_TIMEOUT;
  }

  async chat(request: LlmChatRequest): Promise<LlmChatResponse> {
    const start = Date.now();
    const body: Record<string, unknown> = {
      model: request.model ?? this.model,
      messages: request.messages,
      stream: false,
      options: { temperature: request.temperature ?? 0.2 }
    };
    if (request.jsonSchema) body.format = request.jsonSchema;
    const json = await fetchJson(
      `${this.baseUrl}/api/chat`,
      { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) },
      this.timeoutMs,
      this.id
    );
    return {
      content: json?.message?.content ?? "",
      model: json?.model ?? this.model,
      usage: {
        promptTokens: json?.prompt_eval_count,
        completionTokens: json?.eval_count,
        latencyMs: Date.now() - start
      }
    };
  }

  async embed(request: EmbeddingRequest): Promise<EmbeddingResponse> {
    const model = request.model ?? "nomic-embed-text";
    const json = await fetchJson(
      `${this.baseUrl}/api/embed`,
      { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ model, input: request.texts }) },
      this.timeoutMs,
      this.id
    );
    return { embeddings: json?.embeddings ?? [], model };
  }

  async listModels(): Promise<string[]> {
    const json = await fetchJson(`${this.baseUrl}/api/tags`, { method: "GET" }, 5000, this.id);
    return (json?.models ?? []).map((m: any) => m.name);
  }

  async healthCheck(): Promise<{ ok: boolean; detail: string }> {
    let models: string[];
    try {
      models = await this.listModels();
    } catch {
      return {
        ok: false,
        detail: `Cannot reach Ollama at ${this.baseUrl}. Start it with "ollama serve" (or install it from ollama.com), then check again.`
      };
    }
    if (models.length > 0 && !models.some((m) => m === this.model || m.startsWith(`${this.model}:`))) {
      return {
        ok: false,
        detail: `Ollama is running, but model "${this.model}" is not installed. Run "ollama pull ${this.model}", or set the model to one of: ${models.slice(0, 5).join(", ")}.`
      };
    }
    try {
      return await testChat(this);
    } catch (e) {
      return healthFailure(e, {
        auth: "Check the Ollama base URL — it should not require credentials.",
        notFound: `Model "${this.model}" was not accepted. Run "ollama pull ${this.model}" and check again.`,
        reach: "The model may still be loading (first use can be slow) — try again, or check the base URL."
      });
    }
  }
}

// ---------------------------------------------------------------------------

export class OpenAiProvider implements LlmProvider {
  readonly type = "openai" as const;
  readonly kind = "cloud" as const;
  id: string;
  displayName: string;
  private baseUrl: string;
  private apiKey: string;
  private model: string;
  private timeoutMs: number;

  constructor(cfg: ProviderConfig) {
    if (!cfg.apiKey) throw new LlmProviderError("OpenAI provider requires an API key credential.", cfg.id);
    this.id = cfg.id;
    this.displayName = cfg.displayName || "OpenAI";
    this.baseUrl = (cfg.baseUrl ?? "https://api.openai.com/v1").replace(/\/$/, "");
    this.apiKey = cfg.apiKey;
    this.model = cfg.model ?? "gpt-4o-mini";
    this.timeoutMs = cfg.timeoutMs ?? DEFAULT_TIMEOUT;
  }

  async chat(request: LlmChatRequest): Promise<LlmChatResponse> {
    const start = Date.now();
    const body: Record<string, unknown> = {
      model: request.model ?? this.model,
      messages: request.messages,
      temperature: request.temperature ?? 0.2
    };
    if (request.maxTokens) body.max_tokens = request.maxTokens;
    if (request.jsonSchema) {
      body.response_format = { type: "json_schema", json_schema: { name: "output", schema: request.jsonSchema } };
    }
    const json = await fetchJson(
      `${this.baseUrl}/chat/completions`,
      {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${this.apiKey}` },
        body: JSON.stringify(body)
      },
      this.timeoutMs,
      this.id
    );
    return {
      content: json?.choices?.[0]?.message?.content ?? "",
      model: json?.model ?? this.model,
      usage: {
        promptTokens: json?.usage?.prompt_tokens,
        completionTokens: json?.usage?.completion_tokens,
        latencyMs: Date.now() - start
      }
    };
  }

  async listModels(): Promise<string[]> {
    return [this.model];
  }

  async healthCheck(): Promise<{ ok: boolean; detail: string }> {
    try {
      return await testChat(this);
    } catch (e) {
      return healthFailure(e, {
        auth: "The API key is invalid, revoked, or lacks access — re-enter it in this provider's settings.",
        notFound: `Model "${this.model}" was not found. Check the model name and that your account has access to it.`,
        reach: `Check the base URL (${this.baseUrl}) and your network/proxy settings.`
      });
    }
  }
}

// ---------------------------------------------------------------------------

export class AzureFoundryProvider implements LlmProvider {
  readonly type = "azure_foundry" as const;
  readonly kind = "cloud" as const;
  id: string;
  displayName: string;
  private baseUrl: string;
  private apiKey: string;
  private deployment: string;
  private apiVersion: string;
  private timeoutMs: number;
  /**
   * Azure AI Foundry hosts two different wire protocols under one brand:
   *  - Azure OpenAI-style resources: api-key header, /openai/deployments/{d}/chat/completions.
   *  - Foundry model-catalog deployments whose base URL ends in /anthropic/v1 (e.g. Claude in
   *    Foundry): the Anthropic Messages API — x-api-key header, POST {baseUrl}/messages.
   * The base URL shape is the only reliable signal available at config time.
   */
  private readonly anthropicMode: boolean;

  constructor(cfg: ProviderConfig) {
    if (!cfg.apiKey) throw new LlmProviderError("Azure AI Foundry provider requires an API key credential.", cfg.id);
    if (!cfg.baseUrl) throw new LlmProviderError("Azure AI Foundry provider requires an endpoint URL.", cfg.id);
    this.id = cfg.id;
    this.displayName = cfg.displayName || "Azure AI Foundry";
    this.baseUrl = cfg.baseUrl.replace(/\/$/, "");
    this.apiKey = cfg.apiKey;
    this.anthropicMode = /\/anthropic\/v\d+$/.test(this.baseUrl);
    this.deployment = cfg.deployment ?? cfg.model ?? (this.anthropicMode ? "claude-sonnet-5" : "gpt-4o-mini");
    this.apiVersion = cfg.apiVersion ?? "2024-08-01-preview";
    this.timeoutMs = cfg.timeoutMs ?? DEFAULT_TIMEOUT;
  }

  async chat(request: LlmChatRequest): Promise<LlmChatResponse> {
    return this.anthropicMode ? this.chatAnthropic(request) : this.chatOpenAiCompat(request);
  }

  private async chatOpenAiCompat(request: LlmChatRequest): Promise<LlmChatResponse> {
    const start = Date.now();
    const body: Record<string, unknown> = {
      messages: request.messages,
      temperature: request.temperature ?? 0.2
    };
    if (request.jsonSchema) {
      body.response_format = { type: "json_schema", json_schema: { name: "output", schema: request.jsonSchema } };
    }
    const url = `${this.baseUrl}/openai/deployments/${this.deployment}/chat/completions?api-version=${this.apiVersion}`;
    const json = await fetchJson(
      url,
      { method: "POST", headers: { "content-type": "application/json", "api-key": this.apiKey }, body: JSON.stringify(body) },
      this.timeoutMs,
      this.id
    );
    return {
      content: json?.choices?.[0]?.message?.content ?? "",
      model: json?.model ?? this.deployment,
      usage: {
        promptTokens: json?.usage?.prompt_tokens,
        completionTokens: json?.usage?.completion_tokens,
        latencyMs: Date.now() - start
      }
    };
  }

  /** Anthropic Messages API shape (https://docs.anthropic.com/en/api/messages), as exposed
   * through Azure AI Foundry's Claude deployments. Structured JSON output (chatStructured in
   * gateway.ts) is achieved by prompting for JSON text, not a native response_format param. */
  private async chatAnthropic(request: LlmChatRequest): Promise<LlmChatResponse> {
    const start = Date.now();
    const system = request.messages
      .filter((m) => m.role === "system")
      .map((m) => m.content)
      .join("\n\n");
    const messages = request.messages
      .filter((m) => m.role !== "system")
      .map((m) => ({ role: m.role, content: m.content }));
    const body: Record<string, unknown> = {
      model: this.deployment,
      max_tokens: request.maxTokens ?? 4096,
      messages,
      temperature: request.temperature ?? 0.2
    };
    if (system) body.system = system;
    const json = await fetchJson(
      `${this.baseUrl}/messages`,
      {
        method: "POST",
        headers: { "content-type": "application/json", "x-api-key": this.apiKey, "anthropic-version": "2023-06-01" },
        body: JSON.stringify(body)
      },
      this.timeoutMs,
      this.id
    );
    const text = Array.isArray(json?.content)
      ? json.content.filter((b: any) => b?.type === "text").map((b: any) => b.text).join("")
      : "";
    return {
      content: text,
      model: json?.model ?? this.deployment,
      usage: {
        promptTokens: json?.usage?.input_tokens,
        completionTokens: json?.usage?.output_tokens,
        latencyMs: Date.now() - start
      }
    };
  }

  async listModels(): Promise<string[]> {
    return [this.deployment];
  }

  async healthCheck(): Promise<{ ok: boolean; detail: string }> {
    try {
      return await testChat(this);
    } catch (e) {
      return healthFailure(
        e,
        this.anthropicMode
          ? {
              auth: "The API key is invalid, or this resource does not have the Claude deployment enabled — re-copy the key from this resource in Azure AI Foundry.",
              notFound: `Model "${this.deployment}" was not found at this endpoint. Check the model name matches the Claude deployment in Azure AI Foundry.`,
              reach: `Check the endpoint URL (${this.baseUrl}) — it should end in /anthropic/v1 — and your network/proxy settings.`
            }
          : {
              auth: "The API key is invalid or belongs to a different resource — copy it from the Azure portal for this endpoint.",
              notFound: `Deployment "${this.deployment}" was not found. Verify the deployment name in Azure AI Foundry, the endpoint URL, and the API version (${this.apiVersion}).`,
              reach: `Check the endpoint URL (${this.baseUrl}) — it should look like https://<resource>.openai.azure.com — and your network/proxy settings.`
            }
      );
    }
  }
}

// ---------------------------------------------------------------------------

/** Deterministic mock provider for tests. */
export class MockProvider implements LlmProvider {
  readonly type = "mock" as const;
  readonly kind = "local" as const;
  id: string;
  displayName = "Mock";
  /** Queue of canned responses; falls back to an echo. */
  responses: string[] = [];
  requests: LlmChatRequest[] = [];

  constructor(cfg: Partial<ProviderConfig> = {}) {
    this.id = cfg.id ?? "mock";
  }

  async chat(request: LlmChatRequest): Promise<LlmChatResponse> {
    this.requests.push(request);
    const canned = this.responses.shift();
    const content = canned ?? `mock:${request.messages[request.messages.length - 1]?.content ?? ""}`;
    return { content, model: "mock-1", usage: { promptTokens: 1, completionTokens: 1, latencyMs: 0 } };
  }

  async *streamChat(request: LlmChatRequest): AsyncIterable<LlmStreamEvent> {
    const res = await this.chat(request);
    yield { delta: res.content, done: false };
    yield { delta: "", done: true };
  }

  async embed(request: EmbeddingRequest): Promise<EmbeddingResponse> {
    return { embeddings: request.texts.map((t) => [t.length, 0, 1]), model: "mock-embed" };
  }

  async listModels(): Promise<string[]> {
    return ["mock-1"];
  }

  async healthCheck(): Promise<{ ok: boolean; detail: string }> {
    return { ok: true, detail: "Mock provider." };
  }
}

export function createProvider(cfg: ProviderConfig): LlmProvider {
  switch (cfg.type) {
    case "ollama": return new OllamaProvider(cfg);
    case "openai": return new OpenAiProvider(cfg);
    case "azure_foundry": return new AzureFoundryProvider(cfg);
    case "mock": return new MockProvider(cfg);
    default: throw new LlmProviderError(`Unknown provider type "${cfg.type}".`, cfg.id);
  }
}
