/**
 * Public request/response types. Field names follow Resend's API where a
 * Cloudflare equivalent exists, so code written against `resend` ports over
 * with a one-line client swap.
 */

/** An address in any of the shapes Resend, the Workers binding, or the REST API accept. */
export type EmailAddress =
  | string
  | { email: string; name?: string | null }
  | { address: string; name?: string | null };

/** Canonical address shape used internally and in results. */
export interface NormalizedAddress {
  email: string;
  name?: string;
}

export interface Tag {
  name: string;
  value: string;
}

export interface Attachment {
  filename: string;
  /** Base64 string, or binary content which will be base64-encoded for you. */
  content: string | ArrayBuffer | ArrayBufferView;
  /** MIME type. `content_type` (Resend) and `type` (Cloudflare) are accepted aliases. */
  contentType?: string;
  content_type?: string;
  type?: string;
  /** Defaults to "attachment". Inline attachments require a content id. */
  disposition?: "attachment" | "inline";
  contentId?: string;
  content_id?: string;
}

export interface CreateEmailOptions {
  from: EmailAddress;
  to: EmailAddress | EmailAddress[];
  subject: string;
  html?: string;
  text?: string;
  /**
   * A React element. Rendered to `html` (and `text` when `text` is unset)
   * with the optional peer dependency `@react-email/render`.
   */
  react?: unknown;
  cc?: EmailAddress | EmailAddress[];
  bcc?: EmailAddress | EmailAddress[];
  /** Cloudflare accepts exactly one reply-to address. */
  reply_to?: EmailAddress | EmailAddress[];
  replyTo?: EmailAddress | EmailAddress[];
  /** Custom headers. Must be on Cloudflare's allowlist or start with `X-`. */
  headers?: Record<string, string>;
  /** Resend-style tags. Sent as `X-Tag-<name>: <value>` headers. */
  tags?: Tag[];
  attachments?: Attachment[];
}

export interface RequestOptions {
  /**
   * Replays the cached result instead of sending again when the same key is
   * seen within the idempotency TTL. Requires `idempotencyStore` on the client.
   */
  idempotencyKey?: string;
}

export interface CreateEmailResponseSuccess {
  /** Cloudflare message id. */
  id: string;
  /** Recipient breakdown. Populated by the REST transport; empty for the binding. */
  delivered: string[];
  queued: string[];
  permanent_bounces: string[];
  suppressed_recipients: string[];
  /** True when the response came from the idempotency store rather than a send. */
  replayed?: boolean;
}

/** Internal transport-agnostic message. */
export interface NormalizedMessage {
  from: NormalizedAddress;
  to: NormalizedAddress[];
  cc: NormalizedAddress[];
  bcc: NormalizedAddress[];
  replyTo?: NormalizedAddress;
  subject: string;
  html?: string;
  text?: string;
  headers: Record<string, string>;
  attachments: NormalizedAttachment[];
}

export interface NormalizedAttachment {
  filename: string;
  /** Always base64. */
  content: string;
  type: string;
  disposition: "attachment" | "inline";
  contentId?: string;
}

// ---------------------------------------------------------------------------
// Suppressions (account scoped, REST only)
// ---------------------------------------------------------------------------

export type SuppressionReason =
  | "manual"
  | "complaint"
  | "hard_bounce"
  | "soft_bounce"
  | "policy";

export interface Suppression {
  id: string;
  email: string;
  reason: SuppressionReason | string;
  created_at: string;
  expires_at: string | null;
  read_only: boolean;
  note?: string | null;
}

export interface CreateSuppressionOptions {
  email: string;
  /** ISO-8601. Omit or null for permanent. */
  expires_at?: string | null;
  note?: string;
}

export interface UpdateSuppressionOptions {
  expires_at?: string | null;
  note?: string;
}

export interface ListSuppressionsOptions {
  email?: string;
  reason?: SuppressionReason;
  search?: string;
  cursor?: string;
  per_page?: number;
}

export interface ListSuppressionsResponse {
  data: Suppression[];
  /** Pass back as `cursor` to fetch the next page. */
  next_cursor?: string | null;
}

export interface ImportSuppressionsOptions {
  items: CreateSuppressionOptions[];
}

export interface ImportSuppressionsResponse {
  total: number;
  processed: number;
  deduplicated: number;
  invalid: number;
  skipped: number;
  errors: number;
  items: Array<{
    index: number;
    status: "processed" | "invalid" | "error" | "skipped";
    id?: string;
    email?: string;
    error?: string;
  }>;
}

// ---------------------------------------------------------------------------
// Sending domains (zone scoped, REST only)
// ---------------------------------------------------------------------------

export interface Domain {
  /** Same as Cloudflare's `tag`. */
  id: string;
  tag: string;
  name: string;
  enabled: boolean;
  created?: string;
  modified?: string;
  dkim_selector?: string;
  return_path_domain?: string;
  drop_suppressed_recipients?: boolean;
  preview_enabled?: boolean;
}

export interface ZoneOptions {
  /** Overrides the client-level `zoneId`. */
  zoneId?: string;
}

export interface CreateDomainOptions extends ZoneOptions {
  /** Sending subdomain, e.g. `send.example.com`. */
  name: string;
}

export interface UpdateDomainOptions extends ZoneOptions {
  drop_suppressed_recipients?: boolean;
  preview_enabled?: boolean;
}

export interface DnsRecord {
  type: string;
  name: string;
  content: string;
  ttl?: number;
  priority?: number;
  [key: string]: unknown;
}

// ---------------------------------------------------------------------------
// Batch
// ---------------------------------------------------------------------------

export interface BatchSendOptions extends RequestOptions {
  /** Parallel sends in flight. Default 5. */
  concurrency?: number;
  /** Stop scheduling new sends after the first failure. Default false. */
  stopOnError?: boolean;
}

export interface BatchSendResponse {
  /** One entry per input, in order. `null` where that send failed. */
  data: Array<{ id: string } | null>;
  errors: Array<{ index: number; error: import("./errors").CfEmailError }>;
}

/** Every SDK call resolves to this shape. Exactly one of `data` / `error` is non-null. */
export interface Result<T> {
  data: T | null;
  error: import("./errors").CfEmailError | null;
  /** Response headers when the call went over HTTP. */
  headers?: Headers;
}
