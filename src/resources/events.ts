/**
 * Cloudflare publishes email lifecycle events only through Queues event
 * subscriptions (source `email.sending`). This module types those messages,
 * converts them to Resend-shaped webhook events, and can forward them to an
 * HTTP endpoint with an HMAC signature.
 *
 * Schema: developers.cloudflare.com/queues/event-subscriptions/events-schemas/#email-sending
 */
import { CfEmailError, validationError } from "../errors";

export type CloudflareEmailEventType =
  | "cf.email.sending.message.delivered"
  | "cf.email.sending.message.deferred"
  | "cf.email.sending.message.bounced"
  | "cf.email.sending.message.failed"
  | "cf.email.sending.message.rejected"
  | "cf.email.sending.message.complained";

export interface CloudflareEmailEvent {
  type: CloudflareEmailEventType;
  source: { type: "email.sending"; zoneId: string; domain: string };
  payload: {
    eventId?: string;
    messageId: string;
    sender?: string;
    recipient: string;
    subject?: string;
    terminal: boolean;
    delivery?: {
      status: "delivered" | "deferred" | "bounced" | "failed" | "rejected" | "complained" | string;
      provider?: string;
      deliveryTimeMs?: number;
      smtpStatusCode?: string;
      smtpEnhancedStatusCode?: string;
      smtpResponse?: string;
    };
    bounce?: { type: "hard" | "soft" | string; classification?: string; reason?: string };
    failure?: { reason?: string };
    rejection?: { reason?: string; [key: string]: unknown };
    complaint?: { [key: string]: unknown };
    [key: string]: unknown;
  };
  metadata: {
    accountId: string;
    eventSubscriptionId: string;
    eventSchemaVersion: number;
    eventTimestamp: string;
  };
}

/** Resend-style event names so existing webhook consumers keep working. */
export type EmailEventType =
  | "email.delivered"
  | "email.delivery_delayed"
  | "email.bounced"
  | "email.failed"
  | "email.rejected"
  | "email.complained";

export interface EmailEvent {
  type: EmailEventType;
  created_at: string;
  data: {
    email_id: string;
    event_id?: string;
    from?: string;
    to: string[];
    subject?: string;
    domain: string;
    zone_id: string;
    terminal: boolean;
    delivery?: CloudflareEmailEvent["payload"]["delivery"];
    bounce?: CloudflareEmailEvent["payload"]["bounce"];
    failure?: CloudflareEmailEvent["payload"]["failure"];
    rejection?: CloudflareEmailEvent["payload"]["rejection"];
    complaint?: CloudflareEmailEvent["payload"]["complaint"];
  };
  /** The untouched Cloudflare event. */
  raw: CloudflareEmailEvent;
}

const TYPE_MAP: Record<CloudflareEmailEventType, EmailEventType> = {
  "cf.email.sending.message.delivered": "email.delivered",
  "cf.email.sending.message.deferred": "email.delivery_delayed",
  "cf.email.sending.message.bounced": "email.bounced",
  "cf.email.sending.message.failed": "email.failed",
  "cf.email.sending.message.rejected": "email.rejected",
  "cf.email.sending.message.complained": "email.complained",
};

export function isCloudflareEmailEvent(value: unknown): value is CloudflareEmailEvent {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  if (typeof v.type !== "string" || !(v.type in TYPE_MAP)) return false;
  const payload = v.payload as Record<string, unknown> | undefined;
  return !!payload && typeof payload.messageId === "string" && typeof payload.recipient === "string";
}

/** Parses a queue message body (object or JSON string) into a typed event. Throws on mismatch. */
export function parseEmailEvent(body: unknown): EmailEvent {
  const value = typeof body === "string" ? safeJson(body) : body;
  if (!isCloudflareEmailEvent(value)) {
    throw validationError("Not a Cloudflare email.sending event", value);
  }
  return toEmailEvent(value);
}

export function toEmailEvent(raw: CloudflareEmailEvent): EmailEvent {
  const p = raw.payload;
  const data: EmailEvent["data"] = {
    email_id: p.messageId,
    to: [p.recipient],
    domain: raw.source?.domain,
    zone_id: raw.source?.zoneId,
    terminal: p.terminal,
  };
  if (p.eventId) data.event_id = p.eventId;
  if (p.sender) data.from = p.sender;
  if (p.subject !== undefined) data.subject = p.subject;
  if (p.delivery) data.delivery = p.delivery;
  if (p.bounce) data.bounce = p.bounce;
  if (p.failure) data.failure = p.failure;
  if (p.rejection) data.rejection = p.rejection;
  if (p.complaint) data.complaint = p.complaint;
  return {
    type: TYPE_MAP[raw.type],
    created_at: raw.metadata?.eventTimestamp ?? new Date().toISOString(),
    data,
    raw,
  };
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

// ---------------------------------------------------------------------------
// Queue consumer helpers
// ---------------------------------------------------------------------------

/** Minimal structural view of a Workers `MessageBatch`. */
export interface QueueMessageLike<Body = unknown> {
  body: Body;
  id?: string;
  // Method syntax keeps these bivariant so a real `Message<T>` assigns cleanly.
  ack?(): void;
  retry?(options?: unknown): void;
}

export interface QueueBatchLike<Body = unknown> {
  messages: Iterable<QueueMessageLike<Body>>;
  queue?: string;
}

export type EmailEventHandlers = Partial<Record<EmailEventType, (event: EmailEvent) => unknown>> & {
  /** Called for every event after the specific handler. */
  onEvent?: (event: EmailEvent) => unknown;
  /** Called for messages that are not email events. Default: ack and skip. */
  onUnknown?: (message: QueueMessageLike) => unknown;
  /** Called when a handler throws. Default: message.retry(). */
  onError?: (error: unknown, message: QueueMessageLike) => unknown;
};

/**
 * Dispatches a Queues batch to per-event handlers. Acks handled messages and
 * retries the ones whose handler threw.
 *
 * ```ts
 * export default {
 *   async queue(batch, env) {
 *     await handleEmailEvents(batch, {
 *       "email.bounced": (e) => markBounced(e.data.to[0]),
 *     });
 *   },
 * };
 * ```
 */
export async function handleEmailEvents(
  batch: QueueBatchLike,
  handlers: EmailEventHandlers,
): Promise<{ handled: number; unknown: number; failed: number }> {
  let handled = 0;
  let unknown = 0;
  let failed = 0;
  for (const message of batch.messages) {
    let event: EmailEvent;
    try {
      event = parseEmailEvent(message.body);
    } catch {
      unknown++;
      if (handlers.onUnknown) await handlers.onUnknown(message);
      else message.ack?.();
      continue;
    }
    try {
      const specific = handlers[event.type];
      if (specific) await specific(event);
      if (handlers.onEvent) await handlers.onEvent(event);
      message.ack?.();
      handled++;
    } catch (err) {
      failed++;
      if (handlers.onError) await handlers.onError(err, message);
      else message.retry?.();
    }
  }
  return { handled, unknown, failed };
}

// ---------------------------------------------------------------------------
// Webhook signing / forwarding
// ---------------------------------------------------------------------------

export const SIGNATURE_HEADER = "cfemail-signature";
export const TIMESTAMP_HEADER = "cfemail-timestamp";
export const EVENT_ID_HEADER = "cfemail-event-id";

async function hmacHex(secret: string, payload: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(payload));
  return Array.from(new Uint8Array(sig), (b) => b.toString(16).padStart(2, "0")).join("");
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** Returns `t=<unix seconds>,v1=<hex hmac of "<t>.<body>">`. */
export async function signWebhook(
  body: string,
  secret: string,
  timestamp: number = Math.floor(Date.now() / 1000),
): Promise<string> {
  const digest = await hmacHex(secret, `${timestamp}.${body}`);
  return `t=${timestamp},v1=${digest}`;
}

/** Verifies a signature produced by `signWebhook`. */
export async function verifyWebhook(
  body: string,
  signature: string | null | undefined,
  secret: string,
  options: { toleranceSeconds?: number; now?: number } = {},
): Promise<boolean> {
  if (!signature) return false;
  const parts = Object.fromEntries(
    signature.split(",").map((kv) => {
      const idx = kv.indexOf("=");
      return idx === -1 ? [kv, ""] : [kv.slice(0, idx), kv.slice(idx + 1)];
    }),
  ) as Record<string, string>;
  const t = Number(parts.t);
  const v1 = parts.v1;
  if (!Number.isFinite(t) || !v1) return false;
  const tolerance = options.toleranceSeconds ?? 300;
  const now = options.now ?? Math.floor(Date.now() / 1000);
  if (Math.abs(now - t) > tolerance) return false;
  const expected = await hmacHex(secret, `${t}.${body}`);
  return timingSafeEqual(expected, v1);
}

export interface ForwardOptions {
  url: string;
  secret: string;
  fetch?: typeof fetch;
  /** Extra headers on every delivery. */
  headers?: Record<string, string>;
  /** Send the Resend-shaped event (default) or the raw Cloudflare event. */
  format?: "resend" | "raw";
}

/**
 * POSTs each email event in a Queues batch to `url` with an HMAC signature.
 * Handled messages are acked; failed deliveries are retried by the queue.
 */
export async function forwardEvents(
  batch: QueueBatchLike,
  options: ForwardOptions,
): Promise<{ delivered: number; failed: number; skipped: number }> {
  const fetchImpl = options.fetch ?? globalThis.fetch;
  if (typeof fetchImpl !== "function") {
    throw new CfEmailError("application_error", "No fetch implementation available");
  }
  let delivered = 0;
  let failed = 0;
  let skipped = 0;
  for (const message of batch.messages) {
    let event: EmailEvent;
    try {
      event = parseEmailEvent(message.body);
    } catch {
      skipped++;
      message.ack?.();
      continue;
    }
    const body = JSON.stringify(options.format === "raw" ? event.raw : stripRaw(event));
    const timestamp = Math.floor(Date.now() / 1000);
    const signature = await signWebhook(body, options.secret, timestamp);
    try {
      const res = await fetchImpl(options.url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          [SIGNATURE_HEADER]: signature,
          [TIMESTAMP_HEADER]: String(timestamp),
          [EVENT_ID_HEADER]: event.data.event_id ?? event.data.email_id,
          ...(options.headers ?? {}),
        },
        body,
      });
      if (res.ok) {
        delivered++;
        message.ack?.();
      } else {
        failed++;
        message.retry?.();
      }
    } catch {
      failed++;
      message.retry?.();
    }
  }
  return { delivered, failed, skipped };
}

function stripRaw(event: EmailEvent): Omit<EmailEvent, "raw"> {
  const { raw: _raw, ...rest } = event;
  return rest;
}
