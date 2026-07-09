/** Per-category colors and per-node-type icons for the canvas redesign
 * (design source: "Audit Canvas Options" 1A/1B). Tokens live in styles.css. */

const CATEGORY_KEYS: Record<string, string> = {
  Import: "import",
  Clean: "clean",
  Merge: "merge",
  Transform: "transform",
  Code: "code",
  Visualize: "visualize",
  Governance: "governance",
  AI: "ai"
};

/** CSS var() pair for a node category; unknown categories fall back to Transform. */
export function catColor(category: string | undefined): { ink: string; bg: string } {
  const key = CATEGORY_KEYS[category ?? ""] ?? "transform";
  return { ink: `var(--cat-${key})`, bg: `var(--cat-${key}-bg)` };
}

/** 24-viewBox stroke icon paths, keyed by node type (plus "__note" for sticky notes). */
const ICON_PATHS: Record<string, string> = {
  import_file: "M12 4v10m0 0l-4-4m4 4l4-4M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3",
  import_api: "M12 4a8 8 0 1 0 0 16 8 8 0 0 0 0-16zM12 8v4l3 2",
  import_sample: "M4 5h16v14H4zM4 9h16",
  new_table: "M5 5h14v14H5zM9 9h6v6H9z",
  find_replace: "M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM21 21l-4.3-4.3",
  text_to_columns: "M4 5h16M4 10h16M9 10v9M15 10v9",
  parse_json: "M9 4c-2 0-3 1-3 3v2c0 1-1 2-2 2 1 0 2 1 2 2v2c0 2 1 3 3 3M15 4c2 0 3 1 3 3v2c0 1 1 2 2 2-1 0-2 1-2 2v2c0 2-1 3-3 3",
  sample: "M5 6h14M5 10h14M5 14h8M5 18h4",
  validate: "M12 3l7 3v6c0 4-3 7-7 9-4-2-7-5-7-9V6zM9 12l2 2 4-4",
  join: "M6 4v6a4 4 0 0 0 4 4h4M6 20v-6M14 11l3 3-3 3",
  append: "M8 6v6a4 4 0 0 0 4 4h4M8 20V12M16 6l-3 3 3 3",
  add_columns: "M5 4h6v16H5zM15 9v6M12 12h6",
  edit_columns: "M4 20h4L20 8a2.8 2.8 0 0 0-4-4L4 16v4",
  overwrite_columns: "M5 4h6v16H5zM14 12h6M17 9l3 3-3 3",
  select_columns: "M5 4h5v16H5zM14 4h5v16h-5z",
  filter: "M4 5h16l-6 8v5l-4 2v-7z",
  sort: "M8 4v16M8 20l-3-3M8 20l3-3M16 20V4M16 4l-3 3M16 4l3 3",
  deduplicate: "M4 4h12v12H4zM8 8h12v12H8z",
  pivot: "M4 4h16v16H4zM4 10h16M10 10v10",
  unpivot: "M4 4h16v16H4zM10 4v16M4 10h6",
  python: "M8 5l-5 7 5 7M16 5l5 7-5 7",
  chart: "M5 20V10M11 20V4M17 20v-7M3 20h18",
  publish_toolkit: "M12 15V5M12 5l-4 4M12 5l4 4M5 19h14",
  llm_chat: "M4 5h16v11H9l-5 4z",
  explain_expression: "M9 9a3 3 0 1 1 4.2 2.7c-.9.4-1.2 1-1.2 2.3M12 17.5v.01",
  generate_test_logic: "M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8zM18.5 15.5l.7 1.8 1.8.7-1.8.7-.7 1.8-.7-1.8-1.8-.7 1.8-.7z",
  __note: "M4 6h16M4 12h10M4 18h7"
};

export function NodeIcon({ type, size = 16 }: { type: string; size?: number }) {
  const d = ICON_PATHS[type] ?? "M4 4h16v16H4z";
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={d} />
    </svg>
  );
}
