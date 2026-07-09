import type { CanvasGraph } from "./canvas";

/** Display-only copies of the built-in template graphs, for the rotating landing
 * page illustration (node id/type/label/position + edges + notes; no config,
 * since nothing here is ever executed). Mirrors apps/api/src/templates.ts
 * BUILT_IN_TEMPLATES — keep the graphs in sync if those change. */
export interface LandingScene {
  id: string;
  name: string;
  graph: CanvasGraph;
}

const pos = (x: number, y: number) => ({ x, y });

export const LANDING_SCENES: LandingScene[] = [
  {
    id: "tpl_payroll_ghost",
    name: "Payroll Ghost Employees",
    graph: {
      nodes: [
        { id: "pay", type: "import_file", label: "Import Payroll Register", position: pos(40, 120), config: {} },
        { id: "emp", type: "import_file", label: "Import Employee Master", position: pos(40, 320), config: {} },
        { id: "join", type: "join", label: "Match Payroll to HR Master", position: pos(360, 200), config: {} },
        { id: "ghost", type: "filter", label: "Unknown or Terminated Employees", position: pos(680, 120), config: {} },
        { id: "shared", type: "deduplicate", label: "Shared Bank Accounts", position: pos(680, 340), config: {} }
      ],
      edges: [
        { id: "e1", source: "pay", sourceHandle: "output", target: "join", targetHandle: "left" },
        { id: "e2", source: "emp", sourceHandle: "output", target: "join", targetHandle: "right" },
        { id: "e3", source: "join", sourceHandle: "output", target: "ghost", targetHandle: "input" },
        { id: "e4", source: "pay", sourceHandle: "output", target: "shared", targetHandle: "input" }
      ],
      annotations: [
        {
          id: "n1",
          kind: "note",
          text: "Ghost test: payroll rows with no HR match or terminated status. Duplicates output of Shared Bank Accounts = multiple employees paid to one account.",
          position: pos(1000, 60)
        }
      ]
    }
  },
  {
    id: "tpl_travel_expense",
    name: "Travel & Expense Testing",
    graph: {
      nodes: [
        { id: "imp", type: "import_file", label: "Import Expense Listing", position: pos(40, 200), config: {} },
        { id: "val", type: "validate", label: "Expense Policy Validations", position: pos(360, 80), config: {} },
        { id: "dup", type: "deduplicate", label: "Duplicate Claims", position: pos(360, 340), config: {} }
      ],
      edges: [
        { id: "e1", source: "imp", sourceHandle: "output", target: "val", targetHandle: "input" },
        { id: "e2", source: "imp", sourceHandle: "output", target: "dup", targetHandle: "input" }
      ],
      annotations: [
        {
          id: "note1",
          kind: "note",
          text: "Exceptions output = policy violations for follow-up. Duplicates output = potential duplicate claims.",
          position: pos(700, 40)
        }
      ]
    }
  },
  {
    id: "tpl_p2p_duplicates",
    name: "Procure to Pay Duplicate Payments",
    graph: {
      nodes: [
        { id: "inv", type: "import_file", label: "Import Vendor Invoices", position: pos(40, 120), config: {} },
        { id: "emp", type: "import_file", label: "Import Employee Master", position: pos(40, 380), config: {} },
        { id: "dup", type: "deduplicate", label: "Duplicate Invoice Postings", position: pos(360, 60), config: {} },
        { id: "high", type: "filter", label: "High Value Postings", position: pos(360, 220), config: {} },
        { id: "joinEmp", type: "join", label: "Match Paid Accounts to Employees", position: pos(360, 400), config: {} }
      ],
      edges: [
        { id: "e1", source: "inv", sourceHandle: "output", target: "dup", targetHandle: "input" },
        { id: "e2", source: "inv", sourceHandle: "output", target: "high", targetHandle: "input" },
        { id: "e3", source: "inv", sourceHandle: "output", target: "joinEmp", targetHandle: "left" },
        { id: "e4", source: "emp", sourceHandle: "output", target: "joinEmp", targetHandle: "right" }
      ],
      annotations: [
        {
          id: "n1",
          kind: "note",
          text: "Payments remitted to employees: vendor payments landing in employee bank accounts.",
          position: pos(700, 400)
        }
      ]
    }
  },
  {
    id: "tpl_user_access_review",
    name: "User Access Review",
    graph: {
      nodes: [
        { id: "acc", type: "import_file", label: "Import Access Listing", position: pos(40, 120), config: {} },
        { id: "emp", type: "import_file", label: "Import Employee Master", position: pos(40, 320), config: {} },
        { id: "join", type: "join", label: "Match Accounts to HR", position: pos(360, 200), config: {} },
        { id: "val", type: "validate", label: "Access Review Validations", position: pos(680, 200), config: {} }
      ],
      edges: [
        { id: "e1", source: "acc", sourceHandle: "output", target: "join", targetHandle: "left" },
        { id: "e2", source: "emp", sourceHandle: "output", target: "join", targetHandle: "right" },
        { id: "e3", source: "join", sourceHandle: "output", target: "val", targetHandle: "input" }
      ],
      annotations: []
    }
  }
];
