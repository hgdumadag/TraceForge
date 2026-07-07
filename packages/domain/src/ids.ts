/** ID generation. Uses Web Crypto so it works in Node and browsers. */
export function newId(prefix: string): string {
  const uuid = globalThis.crypto.randomUUID();
  return `${prefix}_${uuid.replace(/-/g, "").slice(0, 16)}`;
}

export function nowIso(): string {
  return new Date().toISOString();
}
