/**
 * Cloudflare Email Service has no server-side idempotency key. The client
 * emulates one with a small key/value store. A Workers `KVNamespace` satisfies
 * this interface directly: `new CfEmail({ binding: env.EMAIL, idempotencyStore: env.KV })`.
 */
export interface IdempotencyStore {
  get(key: string): Promise<string | null | undefined>;
  put(key: string, value: string, options?: { expirationTtl?: number }): Promise<unknown>;
}

export const DEFAULT_IDEMPOTENCY_TTL_SECONDS = 24 * 60 * 60;
const KEY_PREFIX = "cfemail:idem:";

export function idempotencyStorageKey(key: string): string {
  return KEY_PREFIX + key;
}

/** In-memory store for tests and single-process Node apps. */
export function memoryIdempotencyStore(): IdempotencyStore & { size: number; clear(): void } {
  const entries = new Map<string, { value: string; expiresAt: number }>();
  const now = () => Date.now();
  return {
    get size() {
      return entries.size;
    },
    clear() {
      entries.clear();
    },
    async get(key) {
      const entry = entries.get(key);
      if (!entry) return null;
      if (entry.expiresAt <= now()) {
        entries.delete(key);
        return null;
      }
      return entry.value;
    },
    async put(key, value, options) {
      const ttl = options?.expirationTtl ?? DEFAULT_IDEMPOTENCY_TTL_SECONDS;
      entries.set(key, { value, expiresAt: now() + ttl * 1000 });
    },
  };
}
