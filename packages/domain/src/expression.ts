/**
 * TraceForge expression language (features/expression-language.md).
 *
 * Restricted grammar — no eval, no host access. Expressions are parsed into an
 * AST, validated against dataset schema + parameter definitions, and compiled
 * to a safe DuckDB SQL fragment (identifiers quoted, literals escaped,
 * parameters injected as typed literals).
 *
 * Syntax:
 *   {Column Name}                  — column reference
 *   {param!threshold}              — parameter reference
 *   "text", 100, 100.25, true, false, null
 *   = != > >= < <= + - * / and or not contains in
 *   is_null(x), not_null(x), lower(x), upper(x), trim(x), contains(a,b),
 *   days_between(d1,d2), date("2026-01-01"), coalesce(a,b), abs(x), round(x,n), length(x)
 */

import type { ColumnType } from "./enums.js";
import type { ParameterDefinition, ParameterValues } from "./parameters.js";

// ---------------------------------------------------------------------------
// AST
// ---------------------------------------------------------------------------

export type ExprNode =
  | { kind: "literal"; value: string | number | boolean | null; litType: "text" | "number" | "boolean" | "null" }
  | { kind: "column"; name: string }
  | { kind: "param"; key: string }
  | { kind: "unary"; op: "not" | "neg"; operand: ExprNode }
  | { kind: "binary"; op: BinaryOp; left: ExprNode; right: ExprNode }
  | { kind: "call"; fn: string; args: ExprNode[] }
  | { kind: "inList"; value: ExprNode; items: ExprNode[]; negated: boolean };

export type BinaryOp =
  | "=" | "!=" | ">" | ">=" | "<" | "<="
  | "+" | "-" | "*" | "/"
  | "and" | "or"
  | "contains";

export class ExpressionError extends Error {
  constructor(message: string, public position?: number) {
    super(message);
    this.name = "ExpressionError";
  }
}

// ---------------------------------------------------------------------------
// Tokenizer
// ---------------------------------------------------------------------------

type Token =
  | { t: "ref"; name: string; pos: number }        // {Column} or {param!key}
  | { t: "string"; value: string; pos: number }
  | { t: "number"; value: number; pos: number }
  | { t: "ident"; value: string; pos: number }      // keywords + function names
  | { t: "op"; value: string; pos: number }
  | { t: "lparen" | "rparen" | "comma"; pos: number };

const KEYWORDS = new Set(["and", "or", "not", "contains", "in", "true", "false", "null"]);

function tokenize(input: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < input.length) {
    const c = input[i];
    if (/\s/.test(c)) { i++; continue; }
    if (c === "{") {
      const end = input.indexOf("}", i);
      if (end < 0) throw new ExpressionError("Unclosed reference: expected '}'.", i);
      const name = input.slice(i + 1, end).trim();
      if (!name) throw new ExpressionError("Empty reference {} is not allowed.", i);
      tokens.push({ t: "ref", name, pos: i });
      i = end + 1;
      continue;
    }
    if (c === '"' || c === "'") {
      const quote = c;
      let j = i + 1;
      let value = "";
      while (j < input.length && input[j] !== quote) {
        value += input[j];
        j++;
      }
      if (j >= input.length) throw new ExpressionError("Unclosed text literal.", i);
      tokens.push({ t: "string", value, pos: i });
      i = j + 1;
      continue;
    }
    if (/[0-9]/.test(c) || (c === "." && /[0-9]/.test(input[i + 1] ?? ""))) {
      let j = i;
      while (j < input.length && /[0-9.]/.test(input[j])) j++;
      const raw = input.slice(i, j);
      const value = Number(raw);
      if (!Number.isFinite(value)) throw new ExpressionError(`Invalid number "${raw}".`, i);
      tokens.push({ t: "number", value, pos: i });
      i = j;
      continue;
    }
    if (/[A-Za-z_]/.test(c)) {
      let j = i;
      while (j < input.length && /[A-Za-z0-9_]/.test(input[j])) j++;
      const word = input.slice(i, j);
      tokens.push({ t: "ident", value: word.toLowerCase() === word || KEYWORDS.has(word.toLowerCase()) ? word.toLowerCase() : word, pos: i });
      i = j;
      continue;
    }
    if (c === "(") { tokens.push({ t: "lparen", pos: i }); i++; continue; }
    if (c === ")") { tokens.push({ t: "rparen", pos: i }); i++; continue; }
    if (c === ",") { tokens.push({ t: "comma", pos: i }); i++; continue; }
    const two = input.slice(i, i + 2);
    if (two === ">=" || two === "<=" || two === "!=" || two === "<>") {
      tokens.push({ t: "op", value: two === "<>" ? "!=" : two, pos: i });
      i += 2;
      continue;
    }
    if ("=><+-*/".includes(c)) {
      tokens.push({ t: "op", value: c, pos: i });
      i++;
      continue;
    }
    throw new ExpressionError(`Unexpected character "${c}".`, i);
  }
  return tokens;
}

// ---------------------------------------------------------------------------
// Parser (recursive descent; precedence: or < and < not < comparison < additive < multiplicative < unary < primary)
// ---------------------------------------------------------------------------

const FUNCTIONS: Record<string, { arity: number; returns: "boolean" | "text" | "number" | "date" | "any" }> = {
  is_null: { arity: 1, returns: "boolean" },
  not_null: { arity: 1, returns: "boolean" },
  lower: { arity: 1, returns: "text" },
  upper: { arity: 1, returns: "text" },
  trim: { arity: 1, returns: "text" },
  contains: { arity: 2, returns: "boolean" },
  days_between: { arity: 2, returns: "number" },
  date: { arity: 1, returns: "date" },
  coalesce: { arity: 2, returns: "any" },
  abs: { arity: 1, returns: "number" },
  round: { arity: 2, returns: "number" },
  length: { arity: 1, returns: "number" }
};

class Parser {
  private pos = 0;
  constructor(private tokens: Token[]) {}

  parse(): ExprNode {
    const node = this.parseOr();
    if (this.pos < this.tokens.length) {
      const tok = this.tokens[this.pos];
      throw new ExpressionError(`Unexpected token after expression at position ${tok.pos}.`, tok.pos);
    }
    return node;
  }

  private peek(): Token | undefined { return this.tokens[this.pos]; }
  private next(): Token | undefined { return this.tokens[this.pos++]; }

  private parseOr(): ExprNode {
    let left = this.parseAnd();
    while (this.isIdent("or")) {
      this.next();
      left = { kind: "binary", op: "or", left, right: this.parseAnd() };
    }
    return left;
  }

  private parseAnd(): ExprNode {
    let left = this.parseNot();
    while (this.isIdent("and")) {
      this.next();
      left = { kind: "binary", op: "and", left, right: this.parseNot() };
    }
    return left;
  }

  private parseNot(): ExprNode {
    if (this.isIdent("not")) {
      this.next();
      return { kind: "unary", op: "not", operand: this.parseNot() };
    }
    return this.parseComparison();
  }

  private parseComparison(): ExprNode {
    const left = this.parseAdditive();
    const tok = this.peek();
    if (tok?.t === "op" && ["=", "!=", ">", ">=", "<", "<="].includes(tok.value)) {
      this.next();
      return { kind: "binary", op: tok.value as BinaryOp, left, right: this.parseAdditive() };
    }
    if (tok?.t === "ident" && tok.value === "contains") {
      this.next();
      return { kind: "binary", op: "contains", left, right: this.parseAdditive() };
    }
    if (tok?.t === "ident" && tok.value === "in") {
      this.next();
      return this.parseInList(left, false);
    }
    if (tok?.t === "ident" && tok.value === "not" && this.tokens[this.pos + 1]?.t === "ident" && (this.tokens[this.pos + 1] as any).value === "in") {
      this.next(); this.next();
      return this.parseInList(left, true);
    }
    return left;
  }

  private parseInList(value: ExprNode, negated: boolean): ExprNode {
    this.expect("lparen", "Expected '(' after 'in'.");
    const items: ExprNode[] = [];
    for (;;) {
      items.push(this.parseAdditive());
      const tok = this.peek();
      if (tok?.t === "comma") { this.next(); continue; }
      break;
    }
    this.expect("rparen", "Expected ')' to close the 'in' list.");
    return { kind: "inList", value, items, negated };
  }

  private parseAdditive(): ExprNode {
    let left = this.parseMultiplicative();
    for (;;) {
      const tok = this.peek();
      if (tok?.t === "op" && (tok.value === "+" || tok.value === "-")) {
        this.next();
        left = { kind: "binary", op: tok.value as BinaryOp, left, right: this.parseMultiplicative() };
      } else break;
    }
    return left;
  }

  private parseMultiplicative(): ExprNode {
    let left = this.parseUnary();
    for (;;) {
      const tok = this.peek();
      if (tok?.t === "op" && (tok.value === "*" || tok.value === "/")) {
        this.next();
        left = { kind: "binary", op: tok.value as BinaryOp, left, right: this.parseUnary() };
      } else break;
    }
    return left;
  }

  private parseUnary(): ExprNode {
    const tok = this.peek();
    if (tok?.t === "op" && tok.value === "-") {
      this.next();
      return { kind: "unary", op: "neg", operand: this.parseUnary() };
    }
    return this.parsePrimary();
  }

  private parsePrimary(): ExprNode {
    const tok = this.next();
    if (!tok) throw new ExpressionError("Unexpected end of expression.");
    switch (tok.t) {
      case "ref": {
        if (tok.name.startsWith("param!")) {
          const key = tok.name.slice("param!".length).trim();
          if (!key) throw new ExpressionError("Empty parameter reference {param!}.", tok.pos);
          return { kind: "param", key };
        }
        return { kind: "column", name: tok.name };
      }
      case "string":
        return { kind: "literal", value: tok.value, litType: "text" };
      case "number":
        return { kind: "literal", value: tok.value, litType: "number" };
      case "ident": {
        const word = tok.value.toLowerCase();
        if (word === "true") return { kind: "literal", value: true, litType: "boolean" };
        if (word === "false") return { kind: "literal", value: false, litType: "boolean" };
        if (word === "null") return { kind: "literal", value: null, litType: "null" };
        // Function call
        if (this.peek()?.t === "lparen") {
          this.next();
          const args: ExprNode[] = [];
          if (this.peek()?.t !== "rparen") {
            for (;;) {
              args.push(this.parseOr());
              if (this.peek()?.t === "comma") { this.next(); continue; }
              break;
            }
          }
          this.expect("rparen", `Expected ')' to close ${word}(...).`);
          if (!(word in FUNCTIONS)) {
            throw new ExpressionError(
              `Unknown function "${word}". Available functions: ${Object.keys(FUNCTIONS).join(", ")}.`,
              tok.pos
            );
          }
          const fn = FUNCTIONS[word];
          if (args.length !== fn.arity) {
            throw new ExpressionError(`Function ${word} expects ${fn.arity} argument(s), got ${args.length}.`, tok.pos);
          }
          return { kind: "call", fn: word, args };
        }
        throw new ExpressionError(
          `Unexpected word "${tok.value}". Column references must use braces, e.g. {${tok.value}}.`,
          tok.pos
        );
      }
      case "lparen": {
        const inner = this.parseOr();
        this.expect("rparen", "Expected ')' to close '('.");
        return inner;
      }
      default:
        throw new ExpressionError(`Unexpected token at position ${tok.pos}.`, tok.pos);
    }
  }

  private isIdent(word: string): boolean {
    const tok = this.peek();
    return tok?.t === "ident" && tok.value === word;
  }

  private expect(type: Token["t"], message: string): void {
    const tok = this.next();
    if (!tok || tok.t !== type) throw new ExpressionError(message, tok?.pos);
  }
}

export function parseExpression(input: string): ExprNode {
  if (!input || !input.trim()) throw new ExpressionError("Expression is empty.");
  return new Parser(tokenize(input)).parse();
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

export interface ExpressionContext {
  /** column name -> type */
  columns: Record<string, ColumnType>;
  parameters: ParameterDefinition[];
}

export interface ExpressionValidationResult {
  ok: boolean;
  errors: string[];
  /** inferred result type */
  resultType?: InferredType;
}

type InferredType = "boolean" | "number" | "text" | "date" | "null" | "unknown";

function columnInferredType(t: ColumnType): InferredType {
  switch (t) {
    case "integer":
    case "decimal":
      return "number";
    case "boolean":
      return "boolean";
    case "date":
    case "datetime":
      return "date";
    case "text":
      return "text";
    default:
      return "unknown";
  }
}

function paramInferredType(t: ParameterDefinition["type"]): InferredType {
  switch (t) {
    case "integer":
    case "decimal":
      return "number";
    case "boolean":
      return "boolean";
    case "date":
      return "date";
    case "text":
    case "enum":
      return "text";
    case "dataset":
      return "unknown";
  }
}

const comparable = (a: InferredType, b: InferredType) =>
  a === b || a === "unknown" || b === "unknown" || a === "null" || b === "null";

export function validateExpression(input: string | ExprNode, ctx: ExpressionContext): ExpressionValidationResult {
  const errors: string[] = [];
  let ast: ExprNode;
  try {
    ast = typeof input === "string" ? parseExpression(input) : input;
  } catch (e) {
    return { ok: false, errors: [e instanceof Error ? e.message : String(e)] };
  }

  const infer = (node: ExprNode): InferredType => {
    switch (node.kind) {
      case "literal":
        return node.litType === "number" ? "number" : node.litType === "boolean" ? "boolean" : node.litType === "null" ? "null" : "text";
      case "column": {
        if (!(node.name in ctx.columns)) {
          const available = Object.keys(ctx.columns);
          errors.push(
            `Column "${node.name}" was not found in the input data.` +
              (available.length ? ` Available columns: ${available.slice(0, 12).join(", ")}${available.length > 12 ? ", …" : ""}.` : "")
          );
          return "unknown";
        }
        return columnInferredType(ctx.columns[node.name]);
      }
      case "param": {
        const def = ctx.parameters.find((p) => p.key === node.key);
        if (!def) {
          errors.push(
            `Parameter "${node.key}" is not defined for this workflow.` +
              (ctx.parameters.length ? ` Defined parameters: ${ctx.parameters.map((p) => p.key).join(", ")}.` : "")
          );
          return "unknown";
        }
        if (def.type === "dataset") {
          errors.push(`Parameter "${node.key}" is a dataset parameter and cannot be used inside an expression.`);
          return "unknown";
        }
        return paramInferredType(def.type);
      }
      case "unary": {
        const t = infer(node.operand);
        if (node.op === "not" && !comparable(t, "boolean")) errors.push(`"not" requires a true/false value.`);
        if (node.op === "neg" && !comparable(t, "number")) errors.push(`Negation requires a numeric value.`);
        return node.op === "not" ? "boolean" : "number";
      }
      case "binary": {
        const lt = infer(node.left);
        const rt = infer(node.right);
        switch (node.op) {
          case "and":
          case "or":
            if (!comparable(lt, "boolean") || !comparable(rt, "boolean"))
              errors.push(`"${node.op}" requires true/false values on both sides.`);
            return "boolean";
          case "contains":
            if (!comparable(lt, "text") || !comparable(rt, "text"))
              errors.push(`"contains" requires text on both sides.`);
            return "boolean";
          case "+":
          case "-":
          case "*":
          case "/":
            if (!comparable(lt, "number") || !comparable(rt, "number"))
              errors.push(`Arithmetic "${node.op}" requires numeric values. Left side is ${lt}, right side is ${rt}.`);
            return "number";
          default:
            if (!comparable(lt, rt))
              errors.push(`Cannot compare ${lt} with ${rt} using "${node.op}".`);
            return "boolean";
        }
      }
      case "call": {
        const argTypes = node.args.map(infer);
        switch (node.fn) {
          case "lower":
          case "upper":
          case "trim":
            if (!comparable(argTypes[0], "text")) errors.push(`${node.fn}() requires a text value.`);
            break;
          case "contains":
            if (!comparable(argTypes[0], "text") || !comparable(argTypes[1], "text"))
              errors.push(`contains() requires text arguments.`);
            break;
          case "days_between":
            for (const t of argTypes)
              if (!comparable(t, "date")) errors.push(`days_between() requires date values.`);
            break;
          case "date":
            if (!comparable(argTypes[0], "text") && !comparable(argTypes[0], "date"))
              errors.push(`date() requires a text value like date("2026-01-01").`);
            break;
          case "abs":
            if (!comparable(argTypes[0], "number")) errors.push(`abs() requires a numeric value.`);
            break;
          case "round":
            if (!comparable(argTypes[0], "number") || !comparable(argTypes[1], "number"))
              errors.push(`round() requires numeric arguments.`);
            break;
          case "length":
            if (!comparable(argTypes[0], "text")) errors.push(`length() requires a text value.`);
            break;
        }
        const ret = FUNCTIONS[node.fn].returns;
        return ret === "any" ? argTypes[0] ?? "unknown" : ret;
      }
      case "inList": {
        const vt = infer(node.value);
        for (const item of node.items) {
          const it = infer(item);
          if (!comparable(vt, it)) errors.push(`"in" list item type ${it} does not match value type ${vt}.`);
        }
        return "boolean";
      }
    }
  };

  const resultType = infer(ast);
  return { ok: errors.length === 0, errors, resultType };
}

// ---------------------------------------------------------------------------
// SQL compilation (DuckDB dialect). Identifiers quoted, literals escaped,
// parameters injected as typed literals. No raw user text reaches SQL.
// ---------------------------------------------------------------------------

export function quoteIdentifier(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

export function escapeStringLiteral(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

function literalToSql(value: string | number | boolean | null, hint?: ParameterDefinition["type"]): string {
  if (value === null) return "NULL";
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new ExpressionError("Non-finite number cannot be used in SQL.");
    return String(value);
  }
  if (typeof value === "boolean") return value ? "TRUE" : "FALSE";
  if (hint === "date") return `DATE ${escapeStringLiteral(value)}`;
  return escapeStringLiteral(value);
}

export interface CompileOptions {
  /** Resolved parameter values keyed by parameter key. */
  parameterValues: ParameterValues;
  parameterDefinitions: ParameterDefinition[];
}

export function compileExpressionToSql(input: string | ExprNode, opts: CompileOptions): string {
  const ast = typeof input === "string" ? parseExpression(input) : input;

  const emit = (node: ExprNode): string => {
    switch (node.kind) {
      case "literal":
        return literalToSql(node.value);
      case "column":
        return quoteIdentifier(node.name);
      case "param": {
        const def = opts.parameterDefinitions.find((p) => p.key === node.key);
        if (!def) throw new ExpressionError(`Parameter "${node.key}" is not defined.`);
        const value = opts.parameterValues[node.key];
        if (value === undefined) throw new ExpressionError(`Parameter "${node.key}" has no value for this run.`);
        return literalToSql(value, def.type);
      }
      case "unary":
        return node.op === "not" ? `(NOT ${emit(node.operand)})` : `(-${emit(node.operand)})`;
      case "binary": {
        const l = emit(node.left);
        const r = emit(node.right);
        switch (node.op) {
          case "=": return `(${l} = ${r})`;
          case "!=": return `(${l} <> ${r})`;
          case "and": return `(${l} AND ${r})`;
          case "or": return `(${l} OR ${r})`;
          case "contains": return `(contains(CAST(${l} AS VARCHAR), CAST(${r} AS VARCHAR)))`;
          default: return `(${l} ${node.op} ${r})`;
        }
      }
      case "call": {
        const args = node.args.map(emit);
        switch (node.fn) {
          case "is_null": return `(${args[0]} IS NULL)`;
          case "not_null": return `(${args[0]} IS NOT NULL)`;
          case "lower": return `lower(CAST(${args[0]} AS VARCHAR))`;
          case "upper": return `upper(CAST(${args[0]} AS VARCHAR))`;
          case "trim": return `trim(CAST(${args[0]} AS VARCHAR))`;
          case "contains": return `(contains(CAST(${args[0]} AS VARCHAR), CAST(${args[1]} AS VARCHAR)))`;
          case "days_between": return `date_diff('day', CAST(${args[0]} AS DATE), CAST(${args[1]} AS DATE))`;
          case "date": return `CAST(${args[0]} AS DATE)`;
          case "coalesce": return `coalesce(${args[0]}, ${args[1]})`;
          case "abs": return `abs(${args[0]})`;
          case "round": return `round(${args[0]}, ${args[1]})`;
          case "length": return `length(CAST(${args[0]} AS VARCHAR))`;
          default: throw new ExpressionError(`Unknown function "${node.fn}".`);
        }
      }
      case "inList": {
        const list = node.items.map(emit).join(", ");
        return `(${emit(node.value)} ${node.negated ? "NOT IN" : "IN"} (${list}))`;
      }
    }
  };

  return emit(ast);
}

/** Collect referenced column names and parameter keys from an expression. */
export function collectReferences(input: string | ExprNode): { columns: string[]; parameters: string[] } {
  const ast = typeof input === "string" ? parseExpression(input) : input;
  const columns = new Set<string>();
  const parameters = new Set<string>();
  const walk = (node: ExprNode): void => {
    switch (node.kind) {
      case "column": columns.add(node.name); break;
      case "param": parameters.add(node.key); break;
      case "unary": walk(node.operand); break;
      case "binary": walk(node.left); walk(node.right); break;
      case "call": node.args.forEach(walk); break;
      case "inList": walk(node.value); node.items.forEach(walk); break;
      case "literal": break;
    }
  };
  walk(ast);
  return { columns: [...columns], parameters: [...parameters] };
}
