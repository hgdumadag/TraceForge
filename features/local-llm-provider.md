# Feature Specification: Local and Cloud LLM Provider Layer

## What this file is for

This file defines the AI provider abstraction and AI-assisted MVP features, including Ollama/local models, OpenAI, Azure AI Foundry/Azure OpenAI, and future providers.

## When to read this file

Read this file when building or changing:

- LLM provider settings.
- Ollama integration.
- OpenAI or Azure AI Foundry/Azure OpenAI integration.
- AI-assisted workflow generation.
- AI-assisted expression help, documentation, summaries, or test suggestions.
- Data privacy warnings for cloud LLM usage.

## When not to read this file

Do not read this file for non-AI workflow execution, data import, or canvas rendering unless an AI feature touches them.


## Related files

- `../project.md` — global product and architecture rules.
- `../gates.md` — required checks before completion.
- `../decisions.md` — architectural decisions.
- `../glossary.md` — definitions.


## Agent instructions

1. Ollama/local provider should be the default where available.
2. Never send audit data, preview rows, file contents, credentials, or execution outputs to cloud LLMs unless the user explicitly opted in for that action.
3. Provider-specific code must stay behind a provider interface.
4. AI outputs must be validated before becoming workflow JSON, expressions, or code.
5. Add tests for provider selection, cloud warning, local fallback, and schema validation.

---

# 1. Feature summary

The app can use AI to help users create workflows, explain nodes, generate expressions, summarize run results, and draft documentation. AI is optional. The app must work without AI.

Supported provider families:

- Ollama local models.
- OpenAI.
- Azure AI Foundry / Azure OpenAI.
- Future providers through a common interface.

Azure AI Foundry hosts two distinct wire protocols under one brand, both handled by the `azure_foundry` provider type:

- **Azure OpenAI-style resources** — base URL like `https://<resource>.openai.azure.com`. Uses the `api-key` header and `POST {baseUrl}/openai/deployments/{deployment}/chat/completions?api-version=...`.
- **Foundry model-catalog deployments whose endpoint speaks the Anthropic Messages API** (e.g. Claude in Foundry) — base URL ending in `/anthropic/v<N>` (e.g. `https://<resource>.services.ai.azure.com/anthropic/v1`). Uses the `x-api-key` and `anthropic-version` headers and `POST {baseUrl}/messages`, with system-role messages lifted into a top-level `system` field per the Anthropic API contract.

The provider detects which protocol to speak from the base URL shape alone — there is no separate "provider type" to pick in Settings for Claude in Foundry; the same Azure AI Foundry option handles both, and the default model/deployment name falls back to the latest released Claude model when the base URL is Anthropic-shaped and no explicit model is set.

# 2. MVP AI use cases

## 2.1 Generate draft workflow

Acceptance criteria:

- User describes audit objective.
- AI returns proposed workflow metadata, parameters, nodes, edges, and notes.
- Output is displayed for review before saving.
- Output must pass schema validation.
- User can accept, edit, or discard.

## 2.2 Expression assistance

Acceptance criteria:

- User can ask AI to help write a filter/validation expression.
- AI sees schema/column names and parameter names by default, not raw data rows unless user opts in.
- Suggested expression must pass expression validation before insert.

## 2.3 Documentation assistance

Acceptance criteria:

- AI can draft description, business case, requirements/design considerations, or test explanation.
- AI output is editable and not automatically verified.

## 2.4 Run summary assistance

Acceptance criteria:

- AI can summarize run metadata and row counts.
- Raw data rows are excluded by default.
- User must opt in before sending sample rows to cloud provider.

# 3. Provider interface

```ts
interface LlmProvider {
  id: string;
  displayName: string;
  kind: 'local' | 'cloud';
  listModels(): Promise<LlmModel[]>;
  chat(request: LlmChatRequest): Promise<LlmChatResponse>;
  streamChat?(request: LlmChatRequest): AsyncIterable<LlmStreamEvent>;
  embed?(request: EmbeddingRequest): Promise<EmbeddingResponse>;
}
```

Provider settings must include:

- Provider type.
- Base URL.
- Model name.
- API key reference for cloud providers.
- Timeout.
- Whether sample data sharing is allowed.

Provider health check ("Check" in Settings):

- Check sends a real one-line test prompt ("Reply with only the word OK") so a green result means the model actually responds, not merely that settings are filled in. The prompt contains no user data; for cloud providers, clicking Check is the explicit opt-in for that call.
- Success shows the responding model and latency. Failures map to actionable guidance: invalid/revoked key (401/403), wrong model or deployment name (404), rate limit or quota (429), provider outage (5xx), unreachable endpoint, or — for Ollama — not running or model not pulled.
- Error details never include provider response bodies (they may echo credentials); only status codes are interpreted.

Provider selection on AI nodes (LLM Chat, Explain Expression, Generate Test Logic) and AI-assist entry points (inline "AI assist" on expression fields, AI-assisted workflow draft generation):

- Each of these has a Provider picker. "Default (local)" resolves only to a local provider (Ollama); cloud providers are never used implicitly.
- To use a cloud provider (OpenAI, Azure AI Foundry), the user must select it explicitly at the point of use; a cloud warning is shown when one is selected.
- If no local provider exists and the picker is left on Default, the action fails with guidance to select a provider explicitly or add Ollama.
- A cloud provider can never be set as the app-wide default in Settings — the "Make default provider" option is only offered for local provider types, since a cloud default could never actually be used implicitly (it would always hit the explicit-selection requirement above). This is enforced both in the Settings UI and in the gateway itself, so a stale or manually-edited config cannot silently make a cloud provider the default.

# 4. Privacy rules

Default sharing:

| Data type | Local Ollama | Cloud provider |
|---|---:|---:|
| Workflow metadata | Allowed | Allowed with provider selected |
| Column names/schema | Allowed | Allowed with warning/settings |
| Parameter names/defaults | Allowed | Allowed with warning/settings |
| Sample rows | Allowed locally | Explicit opt-in per action |
| Full datasets | Avoid | Not allowed in MVP |
| Credentials/secrets | Never | Never |
| Execution logs | Redacted only | Redacted and opt-in |

# 5. Local model guidance

MVP should not hard-code one model, but can recommend defaults:

- General workflow drafting: Llama 3.1/3.2 8B-class, Qwen2.5/3 7B-class, or similar available through Ollama.
- Coding/expression help: Qwen Coder or DeepSeek Coder class where available locally.
- Summarization: small 3B–8B instruction model.
- Embeddings/RAG: local embedding model such as `nomic-embed-text` or equivalent.

The UI should show that model quality depends on local hardware.

# 6. Data model touchpoints

- `LlmProviderConfig`
- `LlmModelConfig`
- `CredentialReference`
- `AiGenerationSession`
- `AiGeneratedWorkflowDraft`
- `AiPromptAuditLog`

# 7. Tests

Minimum tests:

- Ollama provider can be selected without API key.
- Cloud provider requires credential reference.
- Cloud provider warning appears before first cloud use.
- Raw data rows are not included by default.
- AI-generated workflow schema is validated.
- Invalid AI-generated expression is rejected.
- Provider interface can be mocked in tests.
