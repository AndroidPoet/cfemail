import type { CreateEmailResponseSuccess, NormalizedMessage } from "../types";

export type TransportKind = "binding" | "rest";

export interface TransportResult {
  result: CreateEmailResponseSuccess;
  /** HTTP response headers, when the transport is HTTP based. */
  headers?: Headers;
}

export interface Transport {
  readonly kind: TransportKind;
  /** Sends one message. Throws `CfEmailError` on failure. */
  send(message: NormalizedMessage): Promise<TransportResult>;
}
