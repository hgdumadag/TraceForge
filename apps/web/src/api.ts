/** Typed-ish API client. UI components never touch the database (project.md §9). */

const BASE = "";

async function request<T>(method: string, url: string, body?: unknown): Promise<T> {
  const res = await fetch(`${BASE}${url}`, {
    method,
    headers: body !== undefined ? { "content-type": "application/json" } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined
  });
  if (!res.ok) {
    let message = `Request failed (${res.status})`;
    try {
      const json = await res.json();
      message = json.error ?? message;
      // 422 with sheet selection is a structured response, not an error.
      if (res.status === 422 && json.needsSheetSelection) return json as T;
    } catch {
      /* keep default */
    }
    throw new Error(message);
  }
  const text = await res.text();
  try {
    return JSON.parse(text) as T;
  } catch {
    return text as unknown as T;
  }
}

export const api = {
  get: <T>(url: string) => request<T>("GET", url),
  post: <T>(url: string, body?: unknown) => request<T>("POST", url, body),
  put: <T>(url: string, body?: unknown) => request<T>("PUT", url, body),
  patch: <T>(url: string, body?: unknown) => request<T>("PATCH", url, body),
  del: <T>(url: string) => request<T>("DELETE", url),

  async upload(url: string, file: File, fields: Record<string, string> = {}) {
    const form = new FormData();
    form.append("file", file);
    for (const [k, v] of Object.entries(fields)) form.append(k, v);
    const res = await fetch(`${BASE}${url}`, { method: "POST", body: form });
    const json = await res.json();
    if (!res.ok && !(res.status === 422 && json.needsSheetSelection)) {
      throw new Error(json.error ?? `Upload failed (${res.status})`);
    }
    return json;
  },

  events(executionId: string, onEvent: (e: any) => void): () => void {
    const source = new EventSource(`${BASE}/api/executions/${executionId}/events`);
    source.onmessage = (m) => {
      try {
        onEvent(JSON.parse(m.data));
      } catch {
        /* ignore malformed */
      }
    };
    return () => source.close();
  }
};

// Shared UI types (mirrors domain shapes loosely; the API is the contract).
export interface WorkflowRow {
  id: string;
  name: string;
  description: string;
  category: string;
  serviceTags: string[];
  type: string;
  owner: string;
  status: string;
  activeVersionId: string | null;
  activeVersionNumber: number | null;
  verificationStatus: string;
  publishedBy: string | null;
  publishedAt: string | null;
  automationsConnected: number;
  updatedAt: string;
  templateSourceId?: string | null;
}

export interface VersionRow {
  id: string;
  workflowId: string;
  versionNumber: number;
  status: string;
  graph: any;
  parameters: any[];
  notes: string;
  businessCase: string;
  requirementsAndDesignConsiderations: string;
  createdAt: string;
  updatedAt: string;
  createdBy: string;
  publishedBy: string | null;
  publishedAt: string | null;
  isActive?: boolean;
  verification?: any;
  activatedAt?: string | null;
  activatedBy?: string | null;
  sourceVersionId?: string | null;
}
