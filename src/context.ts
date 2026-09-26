import type { HttpClient } from "./http";
import type { IdempotencyStore } from "./idempotency";
import type { Transport } from "./transports/transport";

/** What resources need from the client. Kept separate to avoid import cycles. */
export interface ClientContext {
  /** Throws `missing_api_key`-style errors when sending is not configured. */
  transport(): Transport;
  /** Throws when no API token / account id is configured. */
  http(): HttpClient;
  accountId(): string;
  zoneId(override?: string): string;
  idempotencyStore?: IdempotencyStore;
  idempotencyTtlSeconds: number;
}
