/**
 * Gateway: provider selection with local-first guardrails.
 * - Ollama is the default provider (ADR-008).
 * - Cloud providers require explicit selection per call (project.md §8.5).
 * - Structured outputs are schema-validated by the caller with zod.
 * - Prompts are redacted before leaving the process.
 */
import { z } from "zod";
import type { LlmProvider, LlmChatRequest, LlmChatResponse, ProviderConfig } from "./types.js";
import { LlmProviderError } from "./types.js";
import { createProvider } from "./providers.js";

const SECRET_PATTERNS: RegExp[] = [
  /(api[-_ ]?key|secret|token|password|bearer)\s*[:=]\s*\S+/gi,
  /sk-[A-Za-z0-9]{16,}/g,
  /eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g // JWTs
];

/** Redact likely secrets from text before logging or sending to any provider. */
export function redactSecrets(text: string): string {
  let out = text;
  for (const pattern of SECRET_PATTERNS) {
    out = out.replace(pattern, "[REDACTED]");
  }
  return out;
}

export interface GatewayCallLog {
  providerId: string;
  providerType: string;
  kind: "local" | "cloud";
  model: string;
  promptChars: number;
  promptTokens?: number;
  completionTokens?: number;
  latencyMs: number;
  at: string;
}

export interface GatewayOptions {
  /** Called after every chat for evidence/audit logging (never contains prompt bodies). */
  onCall?: (log: GatewayCallLog) => void;
}

export class LlmGateway {
  private providers = new Map<string, LlmProvider>();
  private defaultProviderId: string | null = null;

  constructor(private options: GatewayOptions = {}) {}

  registerProvider(cfg: ProviderConfig, makeDefault = false): LlmProvider {
    const provider = createProvider(cfg);
    this.providers.set(provider.id, provider);
    if (makeDefault || (!this.defaultProviderId && provider.kind === "local")) {
      this.defaultProviderId = provider.id;
    }
    return provider;
  }

  removeProvider(id: string): void {
    this.providers.delete(id);
    if (this.defaultProviderId === id) {
      this.defaultProviderId = [...this.providers.values()].find((p) => p.kind === "local")?.id ?? null;
    }
  }

  listProviders(): { id: string; displayName: string; type: string; kind: string; isDefault: boolean }[] {
    return [...this.providers.values()].map((p) => ({
      id: p.id,
      displayName: p.displayName,
      type: p.type,
      kind: p.kind,
      isDefault: p.id === this.defaultProviderId
    }));
  }

  getProvider(id?: string): LlmProvider {
    if (id) {
      const p = this.providers.get(id);
      if (!p) throw new LlmProviderError(`Provider "${id}" is not configured.`, id);
      return p;
    }
    if (!this.defaultProviderId) {
      throw new LlmProviderError("No LLM provider is configured. Add Ollama in Settings to use AI features.", "none");
    }
    return this.providers.get(this.defaultProviderId)!;
  }

  /**
   * Chat through a provider. Cloud providers must be requested EXPLICITLY by id —
   * the default fallback only ever selects local providers.
   */
  async chat(request: LlmChatRequest, providerId?: string): Promise<LlmChatResponse & { providerId: string }> {
    const provider = this.getProvider(providerId);
    if (provider.kind === "cloud" && !providerId) {
      throw new LlmProviderError("Cloud providers must be explicitly selected per action.", provider.id);
    }
    const redacted: LlmChatRequest = {
      ...request,
      messages: request.messages.map((m) => ({ ...m, content: redactSecrets(m.content) }))
    };
    const response = await provider.chat(redacted);
    this.options.onCall?.({
      providerId: provider.id,
      providerType: provider.type,
      kind: provider.kind,
      model: response.model,
      promptChars: redacted.messages.reduce((s, m) => s + m.content.length, 0),
      promptTokens: response.usage.promptTokens,
      completionTokens: response.usage.completionTokens,
      latencyMs: response.usage.latencyMs,
      at: new Date().toISOString()
    });
    return { ...response, providerId: provider.id };
  }

  /** Chat expecting a JSON object validated against a zod schema. */
  async chatStructured<T>(
    request: LlmChatRequest,
    schema: z.ZodType<T>,
    providerId?: string
  ): Promise<{ data: T; providerId: string }> {
    const response = await this.chat(request, providerId);
    let parsed: unknown;
    try {
      // Tolerate markdown-fenced JSON from smaller local models.
      const text = response.content.replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/, "");
      parsed = JSON.parse(text);
    } catch {
      throw new LlmProviderError("The model did not return valid JSON. Try again or use a larger model.", response.providerId);
    }
    const result = schema.safeParse(parsed);
    if (!result.success) {
      throw new LlmProviderError(
        `The model output failed validation: ${result.error.issues.map((i) => i.message).slice(0, 3).join("; ")}`,
        response.providerId
      );
    }
    return { data: result.data, providerId: response.providerId };
  }
}
