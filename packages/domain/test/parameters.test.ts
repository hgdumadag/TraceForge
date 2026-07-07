import { describe, it, expect } from "vitest";
import {
  ParameterDefinitionSchema,
  ParameterDefinitionListSchema,
  resolveParameters,
  type ParameterDefinition
} from "../src/parameters.js";

describe("parameter definitions", () => {
  it("accepts an integer parameter with a default", () => {
    const r = ParameterDefinitionSchema.safeParse({
      key: "receipt_threshold",
      label: "Receipt Threshold",
      type: "integer",
      required: true,
      defaultValue: 75
    });
    expect(r.success).toBe(true);
  });

  it("rejects invalid keys", () => {
    const r = ParameterDefinitionSchema.safeParse({
      key: "Receipt Threshold",
      label: "Receipt Threshold",
      type: "integer"
    });
    expect(r.success).toBe(false);
  });

  it("rejects blank labels", () => {
    const r = ParameterDefinitionSchema.safeParse({ key: "x", label: "", type: "text" });
    expect(r.success).toBe(false);
  });

  it("rejects mismatched default value", () => {
    const r = ParameterDefinitionSchema.safeParse({
      key: "threshold",
      label: "Threshold",
      type: "integer",
      defaultValue: "abc"
    });
    expect(r.success).toBe(false);
  });

  it("requires allowed values for enums", () => {
    const r = ParameterDefinitionSchema.safeParse({ key: "sev", label: "Severity", type: "enum" });
    expect(r.success).toBe(false);
  });

  it("blocks duplicate keys", () => {
    const r = ParameterDefinitionListSchema.safeParse([
      { key: "a", label: "A", type: "text" },
      { key: "a", label: "A2", type: "text" }
    ]);
    expect(r.success).toBe(false);
  });
});

describe("parameter resolution", () => {
  const defs: ParameterDefinition[] = [
    { key: "threshold", label: "Threshold", type: "decimal", required: true, defaultValue: 1000 },
    { key: "start_date", label: "Start Date", type: "date", required: true },
    { key: "note", label: "Note", type: "text", required: false }
  ];

  it("uses defaults when runtime value is absent", () => {
    const r = resolveParameters(defs, { start_date: "2026-01-01" });
    expect(r.ok).toBe(true);
    expect(r.values.threshold).toBe(1000);
  });

  it("runtime overrides win over defaults", () => {
    const r = resolveParameters(defs, { threshold: 500, start_date: "2026-01-01" });
    expect(r.values.threshold).toBe(500);
  });

  it("blocks run when required parameter is missing", () => {
    const r = resolveParameters(defs, {});
    expect(r.ok).toBe(false);
    expect(r.errors.join(" ")).toMatch(/Start Date/);
  });

  it("rejects wrong types", () => {
    const r = resolveParameters(defs, { threshold: "lots", start_date: "2026-01-01" });
    expect(r.ok).toBe(false);
    expect(r.errors[0]).toMatch(/expected a number/);
  });

  it("rejects bad date format", () => {
    const r = resolveParameters(defs, { start_date: "01/01/2026" });
    expect(r.ok).toBe(false);
  });

  it("flags unknown supplied parameters", () => {
    const r = resolveParameters(defs, { start_date: "2026-01-01", mystery: 1 });
    expect(r.ok).toBe(false);
    expect(r.errors[0]).toMatch(/Unknown parameter/);
  });
});
