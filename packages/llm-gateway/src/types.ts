/** LLM provider gateway interface (project.md §6.9, features/local-llm-provider.md). */
import type { LlmProviderType } from "@traceforge/domain";

export interface LlmMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface LlmChatRequest {
  messages: LlmMessage[];
  model?: string;
  temperature?: number;
  maxTokens?: number;
  /** When set, the provider must return JSON conforming to this schema description. */
  jsonSchema?: Record<string, unknown>;
}

export interface LlmUsage {
  promptTokens?: number;
  completionTokens?: number;
  latencyMs: number;
}

export interface LlmChatResponse {
  content: string;
  model: string;
  usage: LlmUsage;
}

export interface LlmStreamEvent {
  delta: string;
  done: boolean;
}

export interface EmbeddingRequest {
  texts: string[];
  model?: string;
}

export interface EmbeddingResponse {
  embeddings: number[][];
  model: string;
}

export interface LlmProvider {
  id: string;
  displayName: string;
  type: LlmProviderType;
  kind: "local" | "cloud";
  chat(request: LlmChatRequest): Promise<LlmChatResponse>;
  streamChat?(request: LlmChatRequest): AsyncIterable<LlmStreamEvent>;
  embed?(request: EmbeddingRequest): Promise<EmbeddingResponse>;
  listModels(): Promise<string[]>;
  healthCheck(): Promise<{ ok: boolean; detail: string }>;
}

export interface ProviderConfig {
  id: string;
  type: LlmProviderType;
  displayName: string;
  baseUrl?: string;
  model?: string;
  /** Credential reference id — resolved by the caller, never stored here raw. */
  apiKey?: string;
  /** Azure deployment name. */
  deployment?: string;
  apiVersion?: string;
  timeoutMs?: number;
  allowSampleDataSharing?: boolean;
}

export class LlmProviderError extends Error {
  constructor(message: string, public providerId: string, public status?: number) {
    super(message);
    this.name = "LlmProviderError";
  }
}
