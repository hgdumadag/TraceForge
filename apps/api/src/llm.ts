/** LLM service: builds the gateway from stored provider configs and exposes
 * AI-assist actions with schema validation (features/local-llm-provider.md). */
import { z } from "zod";
import { LlmGateway, type GatewayCallLog } from "@traceforge/llm-gateway";
import {
  WorkflowGraphSchema,
  ParameterDefinitionListSchema,
  validateGraph,
  validateExpression,
  type ExpressionContext
} from "@traceforge/domain";
import type { Store } from "./store.js";
import type { Vault } from "./crypto.js";

export class LlmService {
  gateway: LlmGateway;

  constructor(private store: Store, private vault: Vault) {
    this.gateway = new LlmGateway({
      onCall: (log: GatewayCallLog) =>
        this.store.saveLlmCall({
          executionId: this.currentExecutionId,
          providerId: log.providerId,
          providerType: log.providerType,
          kind: log.kind,
          model: log.model,
          promptChars: log.promptChars,
          promptTokens: log.promptTokens,
          completionTokens: log.completionTokens,
          latencyMs: log.latencyMs,
          at: log.at
        })
    });
    this.reload();
  }

  /** Set while a workflow execution is calling the gateway, for evidence linkage. */
  currentExecutionId: string | null = null;

  reload(): void {
    const rows = this.store.listLlmProviders();
    // Rebuild from scratch.
    for (const p of this.gateway.listProviders()) this.gateway.removeProvider(p.id);
    let sawDefault = false;
    for (const row of rows) {
      try {
        this.gateway.registerProvider(
          {
            id: row.id,
            type: row.type,
            displayName: row.display_name,
            baseUrl: row.base_url ?? undefined,
            model: row.model ?? undefined,
            deployment: row.deployment ?? undefined,
            apiVersion: row.api_version ?? undefined,
            apiKey: row.api_key_encrypted ? this.vault.decrypt(row.api_key_encrypted) : undefined,
            timeoutMs: row.timeout_ms ?? undefined
          },
          !!row.is_default && !sawDefault
        );
        if (row.is_default) sawDefault = true;
      } catch {
        // A misconfigured provider must not break boot; it simply is not registered.
      }
    }
    // Ensure Ollama exists as the default local provider when nothing is configured (ADR-008).
    if (this.gateway.listProviders().length === 0) {
      this.gateway.registerProvider(
        { id: "ollama-default", type: "ollama", displayName: "Ollama (local)" },
        true
      );
    }
  }

  /** AI workflow draft — validated before it can be saved (project.md §8.5). */
  async generateWorkflowDraft(objective: string, providerId?: string) {
    const schema = z.object({
      name: z.string().min(1),
      description: z.string().default(""),
      category: z.string().default(""),
      parameters: ParameterDefinitionListSchema.default([]),
      graph: WorkflowGraphSchema
    });
    const nodeCatalog =
      "import_file{datasetParameterKey}, filter{expression,emitNonMatching}, validate{rules:[{name,condition,severity}]}, join{joinType,keys:[{left,right}]}, deduplicate{keys,keep}, add_columns{columns:[{name,expression}]}, select_columns{columns}, sort{keys:[{column,direction}]}, append{alignByName}";
    const prompt = [
      "Design an audit analytics workflow as JSON. Respond with ONLY a JSON object with keys: name, description, category, parameters, graph.",
      "graph = {nodes:[{id,type,label,position:{x,y},config}], edges:[{id,source,sourceHandle,target,targetHandle}], annotations:[]}.",
      `Available node types with config shapes: ${nodeCatalog}.`,
      "Expressions use {Column Name} references, {param!key} parameter references, and functions is_null, not_null, days_between, contains, lower, upper, date.",
      "parameters = array of {key,label,type,required,defaultValue} where type is one of text,integer,decimal,boolean,date,enum,dataset. Input files must be dataset parameters used by import_file nodes via datasetParameterKey.",
      "Filter node output handles are named matched/unmatched. Validate node output handles are exceptions/summary. Join inputs are left/right.",
      `Audit objective: ${objective}`
    ].join("\n");
    const { data, providerId: usedProvider } = await this.gateway.chatStructured(
      { messages: [{ role: "user", content: prompt }] },
      schema,
      providerId
    );
    const graphValidation = validateGraph(data.graph, { parameters: data.parameters as never });
    return {
      draft: data,
      providerId: usedProvider,
      valid: graphValidation.ok,
      validationErrors: graphValidation.errors.map((e) => e.message)
    };
  }

  /** Expression suggestion — must pass expression validation before insert. */
  async suggestExpression(request: string, context: ExpressionContext, providerId?: string) {
    const schema = z.object({ expression: z.string().min(1), explanation: z.string().default("") });
    const prompt = [
      "Write ONE expression for an audit analytics filter/validation. Respond with ONLY JSON: {\"expression\": \"...\", \"explanation\": \"...\"}.",
      "Syntax: {Column Name} column refs, {param!key} parameter refs, operators = != > >= < <= and or not contains, functions is_null(x), not_null(x), lower(x), upper(x), trim(x), contains(a,b), days_between(d1,d2), date(\"YYYY-MM-DD\"), coalesce(a,b).",
      `Available columns: ${Object.entries(context.columns).map(([n, t]) => `{${n}} (${t})`).join(", ")}.`,
      `Available parameters: ${context.parameters.map((p) => `{param!${p.key}} (${p.type})`).join(", ") || "none"}.`,
      `Request: ${request}`
    ].join("\n");
    const { data, providerId: usedProvider } = await this.gateway.chatStructured(
      { messages: [{ role: "user", content: prompt }] },
      schema,
      providerId
    );
    const validation = validateExpression(data.expression, context);
    return { ...data, providerId: usedProvider, valid: validation.ok, validationErrors: validation.errors };
  }
}
