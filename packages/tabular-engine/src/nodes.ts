/**
 * Tabular node execution. Every transform reads Parquet input snapshots and
 * materializes new Parquet outputs — prior outputs are never mutated
 * (project.md §8.3, gates.md §4).
 */
import {
  compileExpressionToSql,
  validateExpression,
  quoteIdentifier as qi,
  type ColumnType,
  type DatasetColumn,
  type ParameterDefinition,
  type ParameterValues
} from "@traceforge/domain";
import {
  withConnection,
  materializeToParquet,
  parquetSource,
  duckCastType,
  type MaterializedInfo
} from "./duck.js";

export interface TabularInput {
  path: string;
  columns: DatasetColumn[];
  rowCount: number;
}

export interface TabularNodeContext {
  nodeType: string;
  nodeLabel: string;
  config: Record<string, unknown>;
  /** input handle -> connected inputs in edge order (multi-input handles get several). */
  inputs: Record<string, TabularInput[]>;
  parameterDefinitions: ParameterDefinition[];
  parameterValues: ParameterValues;
  /** Returns the absolute Parquet path to write for a given output handle. */
  outputPathFor: (handle: string) => string;
}

export interface TabularOutput extends MaterializedInfo {
  handle: string;
  path: string;
}

export interface TabularNodeResult {
  outputs: TabularOutput[];
  logs: string[];
}

export class NodeExecutionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NodeExecutionError";
  }
}

function single(ctx: TabularNodeContext, handle: string): TabularInput {
  const arr = ctx.inputs[handle];
  if (!arr || arr.length === 0) {
    throw new NodeExecutionError(`Input "${handle}" is not connected.`);
  }
  return arr[0];
}

function columnsRecord(input: TabularInput): Record<string, ColumnType> {
  return Object.fromEntries(input.columns.map((c) => [c.name, c.type]));
}

function requireColumns(input: TabularInput, names: string[], nodeLabel: string): void {
  const have = new Set(input.columns.map((c) => c.name));
  for (const n of names) {
    if (!have.has(n)) {
      throw new NodeExecutionError(
        `${nodeLabel}: column "${n}" was not found in the input. Available columns: ${[...have].slice(0, 15).join(", ")}.`
      );
    }
  }
}

function compileExpr(ctx: TabularNodeContext, input: TabularInput, expression: string): string {
  const validation = validateExpression(expression, {
    columns: columnsRecord(input),
    parameters: ctx.parameterDefinitions
  });
  if (!validation.ok) {
    throw new NodeExecutionError(`${ctx.nodeLabel}: ${validation.errors.join(" ")}`);
  }
  return compileExpressionToSql(expression, {
    parameterDefinitions: ctx.parameterDefinitions,
    parameterValues: ctx.parameterValues
  });
}

function escRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function escStr(s: string): string {
  return `'${s.replace(/'/g, "''")}'`;
}

const AGGREGATES: Record<string, (col: string) => string> = {
  sum: (c) => `sum(${c})`,
  count: (c) => `count(${c})`,
  min: (c) => `min(${c})`,
  max: (c) => `max(${c})`,
  avg: (c) => `avg(${c})`
};

/** Build the SELECT statements for a node: output handle -> SQL. */
export function buildNodeSql(ctx: TabularNodeContext): Record<string, string> {
  const cfg = ctx.config as never as Record<string, any>;
  switch (ctx.nodeType) {
    case "filter": {
      const input = single(ctx, "input");
      const cond = compileExpr(ctx, input, cfg.expression);
      const limit = cfg.limit ? ` LIMIT ${Number(cfg.limit)}` : "";
      const out: Record<string, string> = {
        matched: `SELECT * FROM ${parquetSource(input.path)} WHERE ${cond}${limit}`
      };
      if (cfg.emitNonMatching) {
        out.unmatched = `SELECT * FROM ${parquetSource(input.path)} WHERE NOT coalesce(${cond}, FALSE)`;
      }
      return out;
    }
    case "add_columns": {
      const input = single(ctx, "input");
      const existing = new Set(input.columns.map((c) => c.name));
      const parts: string[] = [];
      for (const col of cfg.columns) {
        if (existing.has(col.name)) {
          throw new NodeExecutionError(
            `${ctx.nodeLabel}: column "${col.name}" already exists. Use Overwrite Columns to replace values.`
          );
        }
        parts.push(`${compileExpr(ctx, input, col.expression)} AS ${qi(col.name)}`);
      }
      return { output: `SELECT *, ${parts.join(", ")} FROM ${parquetSource(input.path)}` };
    }
    case "overwrite_columns": {
      const input = single(ctx, "input");
      requireColumns(input, cfg.columns.map((c: any) => c.name), ctx.nodeLabel);
      const replaces = cfg.columns
        .map((c: any) => `${compileExpr(ctx, input, c.expression)} AS ${qi(c.name)}`)
        .join(", ");
      return { output: `SELECT * REPLACE (${replaces}) FROM ${parquetSource(input.path)}` };
    }
    case "edit_columns": {
      const input = single(ctx, "input");
      requireColumns(input, cfg.edits.map((e: any) => e.column), ctx.nodeLabel);
      const edits = new Map<string, { rename?: string; newType?: ColumnType }>(
        cfg.edits.map((e: any) => [e.column, e])
      );
      const select = input.columns
        .map((c) => {
          const edit = edits.get(c.name);
          if (!edit) return qi(c.name);
          const source = edit.newType
            ? `TRY_CAST(${qi(c.name)} AS ${duckCastType(edit.newType)})`
            : qi(c.name);
          return `${source} AS ${qi(edit.rename ?? c.name)}`;
        })
        .join(", ");
      return { output: `SELECT ${select} FROM ${parquetSource(input.path)}` };
    }
    case "select_columns": {
      const input = single(ctx, "input");
      requireColumns(input, cfg.columns, ctx.nodeLabel);
      return {
        output: `SELECT ${cfg.columns.map((c: string) => qi(c)).join(", ")} FROM ${parquetSource(input.path)}`
      };
    }
    case "sort": {
      const input = single(ctx, "input");
      requireColumns(input, cfg.keys.map((k: any) => k.column), ctx.nodeLabel);
      const order = cfg.keys
        .map((k: any) => `${qi(k.column)} ${k.direction === "desc" ? "DESC" : "ASC"}`)
        .join(", ");
      return { output: `SELECT * FROM ${parquetSource(input.path)} ORDER BY ${order}` };
    }
    case "deduplicate": {
      const input = single(ctx, "input");
      requireColumns(input, cfg.keys, ctx.nodeLabel);
      if (cfg.keep === "sort") requireColumns(input, [cfg.sortColumn], ctx.nodeLabel);
      const partition = cfg.keys.map((k: string) => qi(k)).join(", ");
      const orderBy =
        cfg.keep === "last"
          ? "_tf_seq DESC"
          : cfg.keep === "sort"
            ? `${qi(cfg.sortColumn)} ${cfg.sortDirection === "desc" ? "DESC" : "ASC"}, _tf_seq ASC`
            : "_tf_seq ASC";
      const ranked = `SELECT *, row_number() OVER (PARTITION BY ${partition} ORDER BY ${orderBy}) AS _tf_rank
        FROM (SELECT *, row_number() OVER () AS _tf_seq FROM ${parquetSource(input.path)})`;
      const cols = input.columns.map((c) => qi(c.name)).join(", ");
      return {
        unique: `SELECT ${cols} FROM (${ranked}) WHERE _tf_rank = 1`,
        duplicates: `SELECT ${cols} FROM (${ranked}) WHERE _tf_rank > 1`
      };
    }
    case "join": {
      const left = single(ctx, "left");
      const right = single(ctx, "right");
      requireColumns(left, cfg.keys.map((k: any) => k.left), `${ctx.nodeLabel} (left input)`);
      requireColumns(right, cfg.keys.map((k: any) => k.right), `${ctx.nodeLabel} (right input)`);
      const joinType = cfg.joinType === "left" ? "LEFT" : cfg.joinType === "full" ? "FULL OUTER" : "INNER";
      const leftNames = new Set(left.columns.map((c) => c.name));
      const rightSelect = right.columns
        .map((c) =>
          leftNames.has(c.name)
            ? `r.${qi(c.name)} AS ${qi(c.name + (cfg.rightSuffix ?? "_right"))}`
            : `r.${qi(c.name)}`
        )
        .join(", ");
      const on = cfg.keys.map((k: any) => `l.${qi(k.left)} = r.${qi(k.right)}`).join(" AND ");
      return {
        output: `SELECT l.*, ${rightSelect} FROM ${parquetSource(left.path)} AS l ${joinType} JOIN ${parquetSource(right.path)} AS r ON ${on}`
      };
    }
    case "append": {
      const inputs = ctx.inputs["input"] ?? [];
      if (inputs.length < 1) throw new NodeExecutionError(`${ctx.nodeLabel}: connect at least one input.`);
      const op = cfg.alignByName ? "UNION ALL BY NAME" : "UNION ALL";
      const sql = inputs.map((i) => `SELECT * FROM ${parquetSource(i.path)}`).join(` ${op} `);
      return { output: sql };
    }
    case "find_replace": {
      const input = single(ctx, "input");
      requireColumns(input, [cfg.column], ctx.nodeLabel);
      const col = qi(cfg.column);
      const replaced = cfg.matchCase
        ? `replace(CAST(${col} AS VARCHAR), ${escStr(cfg.find)}, ${escStr(cfg.replace)})`
        : `regexp_replace(CAST(${col} AS VARCHAR), ${escStr(escRegex(cfg.find))}, ${escStr(cfg.replace)}, 'gi')`;
      return { output: `SELECT * REPLACE (${replaced} AS ${qi(cfg.column)}) FROM ${parquetSource(input.path)}` };
    }
    case "text_to_columns": {
      const input = single(ctx, "input");
      requireColumns(input, [cfg.column], ctx.nodeLabel);
      const parts = cfg.newColumns
        .map(
          (name: string, i: number) =>
            `split_part(CAST(${qi(cfg.column)} AS VARCHAR), ${escStr(cfg.delimiter)}, ${i + 1}) AS ${qi(name)}`
        )
        .join(", ");
      return { output: `SELECT *, ${parts} FROM ${parquetSource(input.path)}` };
    }
    case "parse_json": {
      const input = single(ctx, "input");
      requireColumns(input, [cfg.column], ctx.nodeLabel);
      const parts = cfg.fields
        .map(
          (f: any) =>
            `json_extract_string(CAST(${qi(cfg.column)} AS VARCHAR), ${escStr("$." + f.path)}) AS ${qi(f.name)}`
        )
        .join(", ");
      return { output: `SELECT *, ${parts} FROM ${parquetSource(input.path)}` };
    }
    case "sample": {
      const input = single(ctx, "input");
      const n = Number(cfg.rows);
      if (cfg.mode === "random") {
        return {
          output: `SELECT * FROM ${parquetSource(input.path)} USING SAMPLE reservoir(${n} ROWS) REPEATABLE (42)`
        };
      }
      return { output: `SELECT * FROM ${parquetSource(input.path)} LIMIT ${n}` };
    }
    case "pivot": {
      const input = single(ctx, "input");
      requireColumns(input, [...cfg.groupBy, cfg.pivotColumn, cfg.valueColumn], ctx.nodeLabel);
      const agg = AGGREGATES[cfg.aggregate ?? "sum"](qi(cfg.valueColumn));
      return {
        output: `PIVOT ${parquetSource(input.path)} ON ${qi(cfg.pivotColumn)} USING ${agg} GROUP BY ${cfg.groupBy.map((g: string) => qi(g)).join(", ")}`
      };
    }
    case "unpivot": {
      const input = single(ctx, "input");
      requireColumns(input, [...cfg.idColumns, ...cfg.valueColumns], ctx.nodeLabel);
      const select = [...cfg.idColumns.map((c: string) => qi(c)), qi(cfg.nameTo), qi(cfg.valueTo)].join(", ");
      return {
        output: `SELECT ${select} FROM (UNPIVOT ${parquetSource(input.path)} ON ${cfg.valueColumns.map((c: string) => qi(c)).join(", ")} INTO NAME ${qi(cfg.nameTo)} VALUE ${qi(cfg.valueTo)})`
      };
    }
    case "validate": {
      const input = single(ctx, "input");
      const outputCols: string[] =
        cfg.outputColumns && cfg.outputColumns.length > 0
          ? cfg.outputColumns
          : input.columns.map((c) => c.name);
      requireColumns(input, outputCols, ctx.nodeLabel);
      const colSql = outputCols.map((c) => `CAST(${qi(c)} AS VARCHAR) AS ${qi(c)}`).join(", ");
      const exceptionSelects = cfg.rules.map((rule: any) => {
        const cond = compileExpr(ctx, input, rule.condition);
        return `SELECT ${escStr(rule.name)} AS "Validation", ${escStr(rule.severity)} AS "Severity", ${colSql} FROM ${parquetSource(input.path)} WHERE coalesce(${cond}, FALSE)`;
      });
      const summarySelects = cfg.rules.map((rule: any) => {
        const cond = compileExpr(ctx, input, rule.condition);
        return `SELECT ${escStr(rule.name)} AS "Validation", ${escStr(rule.severity)} AS "Severity", COUNT(*) FILTER (WHERE coalesce(${cond}, FALSE)) AS "Exceptions", COUNT(*) AS "Rows Tested" FROM ${parquetSource(input.path)}`;
      });
      return {
        exceptions: exceptionSelects.join(" UNION ALL "),
        summary: summarySelects.join(" UNION ALL ")
      };
    }
    case "chart": {
      const input = single(ctx, "input");
      requireColumns(input, [cfg.dimension, cfg.measure], ctx.nodeLabel);
      const agg = AGGREGATES[cfg.aggregate ?? "sum"](qi(cfg.measure));
      return {
        output: `SELECT ${qi(cfg.dimension)} AS "Dimension", ${agg} AS "Value" FROM ${parquetSource(input.path)} GROUP BY ${qi(cfg.dimension)} ORDER BY 2 DESC`
      };
    }
    default:
      throw new NodeExecutionError(`Node type "${ctx.nodeType}" is not a tabular transform.`);
  }
}

/** Execute a tabular node: materialize each output SQL into a Parquet snapshot. */
export async function executeTabularNode(ctx: TabularNodeContext): Promise<TabularNodeResult> {
  const sqlByHandle = buildNodeSql(ctx);
  const logs: string[] = [];
  const outputs: TabularOutput[] = [];
  await withConnection(async (conn) => {
    for (const [handle, sql] of Object.entries(sqlByHandle)) {
      const path = ctx.outputPathFor(handle);
      let info: MaterializedInfo;
      try {
        info = await materializeToParquet(conn, sql, path);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        throw new NodeExecutionError(`${ctx.nodeLabel}: ${msg}`);
      }
      logs.push(`${ctx.nodeLabel} → ${handle}: ${info.rowCount} rows, ${info.columns.length} columns`);
      outputs.push({ handle, path, ...info });
    }
  });
  return { outputs, logs };
}
