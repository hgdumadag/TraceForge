/** Built-in audit templates + sample datasets (features/template-library.md §4).
 * Samples are seeded as local datasets on first boot so every template can be
 * tested offline. */
import { join } from "node:path";
import { writeFile, mkdir, rm } from "node:fs/promises";
import { importFileToParquet } from "@traceforge/tabular-engine";
import type { Template } from "@traceforge/domain";
import type { Store } from "./store.js";
import type { AppPaths } from "./db.js";

// ---------------------------------------------------------------------------
// Sample datasets (deterministic, small, offline)
// ---------------------------------------------------------------------------

const SAMPLES: { name: string; csv: string }[] = [
  {
    name: "Sample — Employee Expense Listing",
    csv: `Expense ID,Employee ID,Employee Name,Description,Amount in USD,Date Expense Incurred,Approval Date,Approver ID,Receipt ID
E001,EMP01,Alice Reyes,Team dinner,250.00,2026-01-05,2026-01-10,MGR01,R100
E002,EMP02,Ben Cruz,Hotel - conference,1200.50,2026-01-06,2026-03-20,MGR01,R101
E003,EMP01,Alice Reyes,Taxi,45.25,2026-01-07,2026-01-08,MGR02,
E004,EMP03,Carla Santos,Client gifts and alcohol,530.00,2026-01-08,2026-01-09,MGR02,R103
E005,EMP02,Ben Cruz,Hotel - conference,1200.50,2026-01-06,2026-03-20,MGR01,R101
E006,EMP04,Dan Lim,Office supplies,80.00,2026-01-10,2026-01-12,MGR03,R105
E007,EMP05,Eva Tan,Flight to Manila,950.75,2026-01-11,2026-01-15,MGR01,
E008,EMP03,Carla Santos,Conference registration,400.00,2026-01-12,2026-01-13,MGR02,R107
E009,EMP02,Ben Cruz,Team lunch with wine,180.00,2026-01-14,2026-01-16,EMP02,R108
E010,EMP06,Frank Uy,Parking,25.00,2026-01-15,2026-01-20,MGR03,R109`
  },
  {
    name: "Sample — Employee Master",
    csv: `Employee ID,Employee Name,Department,Status,Termination Date,Bank Account
EMP01,Alice Reyes,Finance,Active,,PH100200300
EMP02,Ben Cruz,Sales,Active,,PH100200301
EMP03,Carla Santos,Marketing,Terminated,2025-12-31,PH100200302
EMP04,Dan Lim,IT,Active,,PH100200303
EMP05,Eva Tan,Operations,Active,,PH100200304
EMP06,Frank Uy,Finance,Active,,PH100200301
EMP07,Gina Ong,HR,Terminated,2025-11-15,PH100200306`
  },
  {
    name: "Sample — Payroll Register",
    csv: `Pay Run,Employee ID,Employee Name,Gross Pay,Bank Account,Pay Date
2026-01,EMP01,Alice Reyes,3500.00,PH100200300,2026-01-30
2026-01,EMP02,Ben Cruz,4200.00,PH100200301,2026-01-30
2026-01,EMP03,Carla Santos,3800.00,PH100200302,2026-01-30
2026-01,EMP04,Dan Lim,3900.00,PH100200303,2026-01-30
2026-01,EMP06,Frank Uy,3100.00,PH100200301,2026-01-30
2026-01,EMP07,Gina Ong,3300.00,PH100200306,2026-01-30
2026-01,EMP99,Zed Ghost,5000.00,PH999999999,2026-01-30`
  },
  {
    name: "Sample — Vendor Invoices",
    csv: `Invoice ID,Vendor ID,Vendor Name,Invoice Number,Amount,Invoice Date,Posting Date,Paid To Account
INV001,V100,Acme Supplies,A-1001,15000.00,2026-01-03,2026-01-05,PH555000111
INV002,V100,Acme Supplies,A-1001,15000.00,2026-01-03,2026-01-15,PH555000111
INV003,V200,Globex Corp,G-2001,8200.00,2026-01-04,2026-01-06,PH555000222
INV004,V300,Initech,I-3001,4500.00,2026-01-06,2026-01-07,PH100200301
INV005,V200,Globex Corp,G-2002,8200.00,2026-01-08,2026-01-09,PH555000222
INV006,V400,Umbrella LLC,U-4001,99000.00,2026-01-09,2026-01-09,PH555000444
INV007,V100,Acme Supplies,A-1002,3000.00,2026-01-10,2026-01-11,PH555000111`
  },
  {
    name: "Sample — User Access Listing",
    csv: `User ID,Employee ID,System,Role,Last Login,Account Status
U001,EMP01,SAP,AP Clerk,2026-01-20,Enabled
U002,EMP02,SAP,Sales Admin,2026-01-22,Enabled
U003,EMP03,SAP,Marketing User,2026-01-02,Enabled
U004,EMP04,SAP,Basis Admin,2026-01-21,Enabled
U005,EMP07,Payroll,Payroll Admin,2025-11-10,Enabled
U006,EMP05,SAP,Viewer,2025-09-01,Enabled
U007,EMP99,SAP,Super User,2026-01-25,Enabled`
  }
];

export async function seedSampleDatasets(store: Store, paths: AppPaths): Promise<void> {
  const existing = new Set(store.listDatasets(["sample"]).map((d) => d.name));
  for (const sample of SAMPLES) {
    if (existing.has(sample.name)) continue;
    const tmp = join(paths.dataDir, "sample-tmp.csv");
    await writeFile(tmp, sample.csv, "utf8");
    const dataset = store.createDataset(sample.name, "sample");
    const out = join(paths.datasetsDir, "samples", `${dataset.id}.parquet`);
    await mkdir(join(paths.datasetsDir, "samples"), { recursive: true });
    const info = await importFileToParquet(tmp, `${sample.name}.csv`, out, { format: "csv" });
    store.createDatasetVersion({
      datasetId: dataset.id,
      storagePath: out,
      contentHash: info.contentHash,
      sourceFileName: `${sample.name}.csv`,
      sourceFileHash: info.fingerprint.contentHash,
      sourceFileSize: info.fingerprint.size,
      rowCount: info.rowCount,
      columns: info.columns
    });
    await rm(tmp, { force: true }).catch(() => {});
  }
}

// ---------------------------------------------------------------------------
// Built-in templates
// ---------------------------------------------------------------------------

const pos = (x: number, y: number) => ({ x, y });

export const BUILT_IN_TEMPLATES: Template[] = [
  {
    id: "tpl_blank",
    version: 1,
    name: "Blank Audit Workflow",
    description: "Start from an empty canvas.",
    category: "General",
    tags: [],
    riskStatement: "",
    requiredInputs: [],
    parameters: [],
    graph: { nodes: [], edges: [], annotations: [] },
    expectedOutputs: [],
    containsCustomCode: false,
    requiresCredential: false,
    sampleDatasetIds: [],
    builtIn: true
  },
  {
    id: "tpl_travel_expense",
    version: 1,
    name: "Travel & Expense Testing",
    description:
      "Tests employee expenses for missing receipts over a threshold, untimely approvals, self-approval, prohibited keywords, and duplicate claims.",
    category: "Travel & Expense",
    tags: ["T&E", "expenses", "receipts"],
    riskStatement:
      "Inappropriate, unsupported, or duplicate employee expenses are reimbursed, causing financial loss and policy violations.",
    requiredInputs: [{ name: "Employee Expense Listing", description: "Expense report lines with amounts, dates, approver, and receipt references." }],
    parameters: [
      { key: "expense_listing", label: "Employee Expense Listing", type: "dataset", required: true },
      { key: "receipt_threshold", label: "Receipt Threshold", type: "decimal", required: true, defaultValue: 75 },
      { key: "timeliness_threshold", label: "Timeliness Threshold (days)", type: "integer", required: true, defaultValue: 60 },
      { key: "prohibited_keyword", label: "Prohibited Keyword", type: "text", required: true, defaultValue: "alcohol" }
    ],
    graph: {
      nodes: [
        { id: "imp", type: "import_file", label: "Import Expense Listing", position: pos(40, 200), config: { datasetParameterKey: "expense_listing" } },
        {
          id: "val",
          type: "validate",
          label: "Expense Policy Validations",
          position: pos(360, 80),
          config: {
            rules: [
              { name: "Missing receipt over threshold", condition: "is_null({Receipt ID}) and {Amount in USD} > {param!receipt_threshold}", severity: "high" },
              { name: "Untimely approval", condition: "days_between({Date Expense Incurred}, {Approval Date}) > {param!timeliness_threshold}", severity: "medium" },
              { name: "Self-approved expense", condition: "{Approver ID} = {Employee ID}", severity: "high" },
              { name: "Prohibited keyword", condition: "contains(lower({Description}), lower({param!prohibited_keyword}))", severity: "medium" }
            ]
          }
        },
        {
          id: "dup",
          type: "deduplicate",
          label: "Duplicate Claims",
          position: pos(360, 340),
          config: { keys: ["Employee ID", "Amount in USD", "Description", "Date Expense Incurred"], keep: "first" }
        }
      ],
      edges: [
        { id: "e1", source: "imp", sourceHandle: "output", target: "val", targetHandle: "input" },
        { id: "e2", source: "imp", sourceHandle: "output", target: "dup", targetHandle: "input" }
      ],
      annotations: [
        { id: "note1", kind: "note", text: "Exceptions output = policy violations for follow-up. Duplicates output = potential duplicate claims.", position: pos(700, 40) }
      ]
    },
    expectedOutputs: ["Policy exceptions", "Validation summary", "Duplicate claims"],
    containsCustomCode: false,
    requiresCredential: false,
    sampleDatasetIds: ["Sample — Employee Expense Listing"],
    builtIn: true
  },
  {
    id: "tpl_payroll_ghost",
    version: 1,
    name: "Payroll Ghost Employees",
    description:
      "Compares the payroll register to the employee master to find payments to unknown or terminated employees and shared bank accounts.",
    category: "Payroll",
    tags: ["payroll", "ghost employees"],
    riskStatement: "Payroll is disbursed to fictitious or terminated employees.",
    requiredInputs: [
      { name: "Payroll Register", description: "Payments per pay run with employee IDs and bank accounts." },
      { name: "Employee Master", description: "HR employee listing with status and termination dates." }
    ],
    parameters: [
      { key: "payroll_register", label: "Payroll Register", type: "dataset", required: true },
      { key: "employee_master", label: "Employee Master", type: "dataset", required: true }
    ],
    graph: {
      nodes: [
        { id: "pay", type: "import_file", label: "Import Payroll Register", position: pos(40, 120), config: { datasetParameterKey: "payroll_register" } },
        { id: "emp", type: "import_file", label: "Import Employee Master", position: pos(40, 320), config: { datasetParameterKey: "employee_master" } },
        {
          id: "join",
          type: "join",
          label: "Match Payroll to HR Master",
          position: pos(360, 200),
          config: { joinType: "left", keys: [{ left: "Employee ID", right: "Employee ID" }], rightSuffix: "_hr" }
        },
        {
          id: "ghost",
          type: "filter",
          label: "Unknown or Terminated Employees",
          position: pos(680, 120),
          config: { expression: 'is_null({Status}) or {Status} = "Terminated"', emitNonMatching: false }
        },
        {
          id: "shared",
          type: "deduplicate",
          label: "Shared Bank Accounts",
          position: pos(680, 340),
          config: { keys: ["Bank Account"], keep: "first" }
        }
      ],
      edges: [
        { id: "e1", source: "pay", sourceHandle: "output", target: "join", targetHandle: "left" },
        { id: "e2", source: "emp", sourceHandle: "output", target: "join", targetHandle: "right" },
        { id: "e3", source: "join", sourceHandle: "output", target: "ghost", targetHandle: "input" },
        { id: "e4", source: "pay", sourceHandle: "output", target: "shared", targetHandle: "input" }
      ],
      annotations: [
        { id: "n1", kind: "note", text: "Ghost test: payroll rows with no HR match or terminated status. Duplicates output of Shared Bank Accounts = multiple employees paid to one account.", position: pos(1000, 60) }
      ]
    },
    expectedOutputs: ["Ghost employee payments", "Shared bank account payments"],
    containsCustomCode: false,
    requiresCredential: false,
    sampleDatasetIds: ["Sample — Payroll Register", "Sample — Employee Master"],
    builtIn: true
  },
  {
    id: "tpl_p2p_duplicates",
    version: 1,
    name: "Procure to Pay Duplicate Payments",
    description:
      "Finds duplicate and suspicious vendor invoice postings: same vendor + invoice number + amount, and payments remitted to employee bank accounts.",
    category: "Procure to Pay",
    tags: ["P2P", "duplicates", "vendors"],
    riskStatement: "Duplicate or fraudulent vendor payments cause financial loss.",
    requiredInputs: [
      { name: "Vendor Invoices", description: "Posted vendor invoices with vendor, invoice number, amount, and paid-to account." },
      { name: "Employee Master", description: "Employee listing with bank accounts (for employee-remittance test)." }
    ],
    parameters: [
      { key: "vendor_invoices", label: "Vendor Invoices", type: "dataset", required: true },
      { key: "employee_master", label: "Employee Master", type: "dataset", required: true },
      { key: "high_amount", label: "High Amount Threshold", type: "decimal", required: true, defaultValue: 50000 }
    ],
    graph: {
      nodes: [
        { id: "inv", type: "import_file", label: "Import Vendor Invoices", position: pos(40, 120), config: { datasetParameterKey: "vendor_invoices" } },
        { id: "emp", type: "import_file", label: "Import Employee Master", position: pos(40, 380), config: { datasetParameterKey: "employee_master" } },
        {
          id: "dup",
          type: "deduplicate",
          label: "Duplicate Invoice Postings",
          position: pos(360, 60),
          config: { keys: ["Vendor ID", "Invoice Number", "Amount"], keep: "first" }
        },
        {
          id: "high",
          type: "filter",
          label: "High Value Postings",
          position: pos(360, 220),
          config: { expression: "{Amount} >= {param!high_amount}", emitNonMatching: false }
        },
        {
          id: "joinEmp",
          type: "join",
          label: "Match Paid Accounts to Employees",
          position: pos(360, 400),
          config: { joinType: "inner", keys: [{ left: "Paid To Account", right: "Bank Account" }], rightSuffix: "_emp" }
        }
      ],
      edges: [
        { id: "e1", source: "inv", sourceHandle: "output", target: "dup", targetHandle: "input" },
        { id: "e2", source: "inv", sourceHandle: "output", target: "high", targetHandle: "input" },
        { id: "e3", source: "inv", sourceHandle: "output", target: "joinEmp", targetHandle: "left" },
        { id: "e4", source: "emp", sourceHandle: "output", target: "joinEmp", targetHandle: "right" }
      ],
      annotations: [
        { id: "n1", kind: "note", text: "Payments remitted to employees: vendor payments landing in employee bank accounts.", position: pos(700, 400) }
      ]
    },
    expectedOutputs: ["Duplicate postings", "High value postings", "Payments to employee accounts"],
    containsCustomCode: false,
    requiresCredential: false,
    sampleDatasetIds: ["Sample — Vendor Invoices", "Sample — Employee Master"],
    builtIn: true
  },
  {
    id: "tpl_user_access_review",
    version: 1,
    name: "User Access Review",
    description:
      "Reviews system access: accounts belonging to terminated employees, accounts with no HR match, and dormant accounts still enabled.",
    category: "IT Controls",
    tags: ["ITGC", "access", "UAR"],
    riskStatement: "Terminated or unknown users retain system access, enabling unauthorized activity.",
    requiredInputs: [
      { name: "User Access Listing", description: "System accounts with employee IDs, roles, and last login." },
      { name: "Employee Master", description: "HR listing with employment status." }
    ],
    parameters: [
      { key: "access_listing", label: "User Access Listing", type: "dataset", required: true },
      { key: "employee_master", label: "Employee Master", type: "dataset", required: true },
      { key: "dormant_days", label: "Dormant Days Threshold", type: "integer", required: true, defaultValue: 90 },
      { key: "review_date", label: "Review Date", type: "date", required: true, defaultValue: "2026-01-31" }
    ],
    graph: {
      nodes: [
        { id: "acc", type: "import_file", label: "Import Access Listing", position: pos(40, 120), config: { datasetParameterKey: "access_listing" } },
        { id: "emp", type: "import_file", label: "Import Employee Master", position: pos(40, 320), config: { datasetParameterKey: "employee_master" } },
        {
          id: "join",
          type: "join",
          label: "Match Accounts to HR",
          position: pos(360, 200),
          config: { joinType: "left", keys: [{ left: "Employee ID", right: "Employee ID" }], rightSuffix: "_hr" }
        },
        {
          id: "val",
          type: "validate",
          label: "Access Review Validations",
          position: pos(680, 200),
          config: {
            rules: [
              { name: "Terminated employee with enabled account", condition: '{Status} = "Terminated" and {Account Status} = "Enabled"', severity: "high" },
              { name: "Account with no HR match", condition: "is_null({Status})", severity: "high" },
              { name: "Dormant enabled account", condition: 'days_between(date({Last Login}), {param!review_date}) > {param!dormant_days} and {Account Status} = "Enabled"', severity: "medium" }
            ]
          }
        }
      ],
      edges: [
        { id: "e1", source: "acc", sourceHandle: "output", target: "join", targetHandle: "left" },
        { id: "e2", source: "emp", sourceHandle: "output", target: "join", targetHandle: "right" },
        { id: "e3", source: "join", sourceHandle: "output", target: "val", targetHandle: "input" }
      ],
      annotations: []
    },
    expectedOutputs: ["Access exceptions", "Validation summary"],
    containsCustomCode: false,
    requiresCredential: false,
    sampleDatasetIds: ["Sample — User Access Listing", "Sample — Employee Master"],
    builtIn: true
  }
];

export function getTemplate(id: string): Template | undefined {
  return BUILT_IN_TEMPLATES.find((t) => t.id === id);
}
