import { describe, it, expect } from "vitest";
import { z } from "zod";
import { LlmGateway, MockProvider, redactSecrets, LlmProviderError, createProvider } from "../src/index.js";

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
