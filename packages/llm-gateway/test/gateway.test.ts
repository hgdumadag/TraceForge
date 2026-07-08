import { describe, it, expect, vi, afterEach } from "vitest";
import { z } from "zod";
import { LlmGateway, MockProvider, redactSecrets, LlmProviderError, createProvider } from "../src/index.js";

function stubFetch(response: unknown, status = 200) {
  const fetchMock = vi.fn().mockResolvedValue({
    ok: status < 400,
    status,
    json: async () => response
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("redaction", () => {
  it("redacts api keys, tokens, and JWTs", () => {
    expect(redactSecrets("my api_key: abc123secret")).toContain("[REDACTED]");
    expect(redactSecrets("Bearer= xyz")).toContain("[REDACTED]");
    expect(redactSecrets("sk-abcdefghijklmnopqrstuvwx")).toBe("[REDACTED]");
    const jwt = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U";
    expect(redactSecrets(`token body ${jwt}`)).toContain("[REDACTED]");
  });

  it("keeps ordinary audit text intact", () => {
    const text = "Filter expenses where {Amount in USD} > 1000 and flag missing receipts";
    expect(redactSecrets(text)).toBe(text);
  });
});

describe("gateway provider selection", () => {
  it("uses the local default provider when none specified", async () => {
    const gw = new LlmGateway();
    gw.registerProvider({ id: "mock1", type: "mock", displayName: "Mock" });
    const res = await gw.chat({ messages: [{ role: "user", content: "hello" }] });
    expect(res.providerId).toBe("mock1");
    expect(res.content).toBe("mock:hello");
  });

  it("never lets a cloud provider become the implicit default, even when asked to", async () => {
    const gw = new LlmGateway();
    // makeDefault=true mirrors a stored is_default=1 row for a cloud provider — a state
    // the Settings UI should now prevent creating, but old data or a bug could still produce.
    gw.registerProvider({ id: "az", type: "azure_foundry", displayName: "Azure", apiKey: "k", baseUrl: "https://x.openai.azure.com" }, true);
    gw.registerProvider({ id: "mock1", type: "mock", displayName: "Mock" });
    const providers = gw.listProviders();
    expect(providers.find((p) => p.id === "az")?.isDefault).toBe(false);
    expect(providers.find((p) => p.id === "mock1")?.isDefault).toBe(true);
    // Calling with no providerId must resolve to the local provider, not throw.
    const res = await gw.chat({ messages: [{ role: "user", content: "hello" }] });
    expect(res.providerId).toBe("mock1");
  });

  it("requires cloud providers to be explicitly configured with credentials", () => {
    expect(() =>
      createProvider({ id: "oai", type: "openai", displayName: "OpenAI" })
    ).toThrow(/API key/);
    expect(() =>
      createProvider({ id: "az", type: "azure_foundry", displayName: "Azure", apiKey: "k" })
    ).toThrow(/endpoint/);
  });

  it("errors clearly when no provider is configured", async () => {
    const gw = new LlmGateway();
    await expect(gw.chat({ messages: [{ role: "user", content: "x" }] })).rejects.toThrow(/No LLM provider/);
  });

  it("logs call metadata without prompt bodies", async () => {
    const logs: any[] = [];
    const gw = new LlmGateway({ onCall: (l) => logs.push(l) });
    gw.registerProvider({ id: "mock1", type: "mock", displayName: "Mock" });
    await gw.chat({ messages: [{ role: "user", content: "sensitive audit content" }] });
    expect(logs.length).toBe(1);
    expect(logs[0].providerId).toBe("mock1");
    expect(JSON.stringify(logs[0])).not.toContain("sensitive audit content");
    expect(logs[0].promptChars).toBeGreaterThan(0);
  });

  it("redacts secrets from outbound messages", async () => {
    const gw = new LlmGateway();
    const mock = gw.registerProvider({ id: "mock1", type: "mock", displayName: "Mock" }) as MockProvider;
    await gw.chat({ messages: [{ role: "user", content: "use api_key: supersecret123 to connect" }] });
    expect(mock.requests[0].messages[0].content).toContain("[REDACTED]");
    expect(mock.requests[0].messages[0].content).not.toContain("supersecret123");
  });
});

describe("structured output", () => {
  const schema = z.object({ name: z.string(), threshold: z.number() });

  it("parses and validates JSON output", async () => {
    const gw = new LlmGateway();
    const mock = gw.registerProvider({ id: "m", type: "mock", displayName: "Mock" }) as MockProvider;
    mock.responses.push('{"name": "T&E Test", "threshold": 75}');
    const { data } = await gw.chatStructured({ messages: [{ role: "user", content: "go" }] }, schema);
    expect(data.name).toBe("T&E Test");
  });

  it("tolerates markdown fences", async () => {
    const gw = new LlmGateway();
    const mock = gw.registerProvider({ id: "m", type: "mock", displayName: "Mock" }) as MockProvider;
    mock.responses.push('```json\n{"name": "X", "threshold": 1}\n```');
    const { data } = await gw.chatStructured({ messages: [{ role: "user", content: "go" }] }, schema);
    expect(data.threshold).toBe(1);
  });

  it("rejects invalid JSON with a safe error", async () => {
    const gw = new LlmGateway();
    const mock = gw.registerProvider({ id: "m", type: "mock", displayName: "Mock" }) as MockProvider;
    mock.responses.push("this is not json");
    await expect(
      gw.chatStructured({ messages: [{ role: "user", content: "go" }] }, schema)
    ).rejects.toThrow(LlmProviderError);
  });

  it("rejects schema-invalid output", async () => {
    const gw = new LlmGateway();
    const mock = gw.registerProvider({ id: "m", type: "mock", displayName: "Mock" }) as MockProvider;
    mock.responses.push('{"name": 5}');
    await expect(
      gw.chatStructured({ messages: [{ role: "user", content: "go" }] }, schema)
    ).rejects.toThrow(/validation/);
  });
});

describe("azure foundry provider protocol detection", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("speaks Azure OpenAI's protocol for a classic resource URL", async () => {
    const fetchMock = stubFetch({
      model: "gpt-4o-mini",
      choices: [{ message: { content: "hi" } }],
      usage: { prompt_tokens: 3, completion_tokens: 1 }
    });
    const provider = createProvider({
      id: "az",
      type: "azure_foundry",
      displayName: "Azure",
      apiKey: "k",
      baseUrl: "https://my-resource.openai.azure.com",
      deployment: "gpt-4o-mini"
    });
    const res = await provider.chat({ messages: [{ role: "user", content: "hello" }] });
    expect(res.content).toBe("hi");
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toContain("/openai/deployments/gpt-4o-mini/chat/completions");
    expect((init.headers as Record<string, string>)["api-key"]).toBe("k");
    expect((init.headers as Record<string, string>)["x-api-key"]).toBeUndefined();
  });

  it("speaks the Anthropic Messages API for a Claude-in-Foundry URL", async () => {
    const fetchMock = stubFetch({
      model: "claude-sonnet-4-5",
      content: [{ type: "text", text: "hi" }],
      usage: { input_tokens: 5, output_tokens: 2 }
    });
    const provider = createProvider({
      id: "az-claude",
      type: "azure_foundry",
      displayName: "Claude in Foundry",
      apiKey: "k",
      baseUrl: "https://my-claude-resource.services.ai.azure.com/anthropic/v1/",
      deployment: "claude-sonnet-4-5"
    });
    const res = await provider.chat({
      messages: [
        { role: "system", content: "You are terse." },
        { role: "user", content: "hello" }
      ]
    });
    expect(res.content).toBe("hi");
    expect(res.usage.promptTokens).toBe(5);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://my-claude-resource.services.ai.azure.com/anthropic/v1/messages");
    const headers = init.headers as Record<string, string>;
    expect(headers["x-api-key"]).toBe("k");
    expect(headers["anthropic-version"]).toBeTruthy();
    expect(headers["api-key"]).toBeUndefined();
    const body = JSON.parse(init.body as string);
    expect(body.system).toBe("You are terse.");
    expect(body.messages).toEqual([{ role: "user", content: "hello" }]);
    expect(body.max_tokens).toBeGreaterThan(0);
  });
});
