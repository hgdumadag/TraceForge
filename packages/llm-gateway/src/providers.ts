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
      throw new LlmProviderError(`Provider request failed with status ${res.status}.`, providerId);
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
    try {
      const models = await this.listModels();
      return { ok: true, detail: `Ollama reachable with ${models.length} model(s).` };
    } catch (e) {
      return { ok: false, detail: e instanceof Error ? e.message : "Ollama is unreachable." };
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
    return { ok: !!this.apiKey, detail: this.apiKey ? "API key configured." : "Missing API key." };
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

  constructor(cfg: ProviderConfig) {
    if (!cfg.apiKey) throw new LlmProviderError("Azure AI Foundry provider requires an API key credential.", cfg.id);
    if (!cfg.baseUrl) throw new LlmProviderError("Azure AI Foundry provider requires an endpoint URL.", cfg.id);
    this.id = cfg.id;
    this.displayName = cfg.displayName || "Azure AI Foundry";
    this.baseUrl = cfg.baseUrl.replace(/\/$/, "");
    this.apiKey = cfg.apiKey;
    this.deployment = cfg.deployment ?? cfg.model ?? "gpt-4o-mini";
    this.apiVersion = cfg.apiVersion ?? "2024-08-01-preview";
    this.timeoutMs = cfg.timeoutMs ?? DEFAULT_TIMEOUT;
  }

  async chat(request: LlmChatRequest): Promise<LlmChatResponse> {
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

  async listModels(): Promise<string[]> {
    return [this.deployment];
  }

  async healthCheck(): Promise<{ ok: boolean; detail: string }> {
    return { ok: true, detail: "Configured. Calls are made only when explicitly selected." };
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
