/**
 * Test doubles. Import from `cfemail/testing`.
 */
import type { BindingMessage, SendEmailBinding } from "./transports/binding";

export interface MockBindingOptions {
  /** Throw an error with this `code` (e.g. `E_RECIPIENT_SUPPRESSED`) instead of sending. */
  failWith?: string;
  /** Custom message id generator. */
  messageId?: (index: number) => string;
  /** Optional per-message hook to decide success/failure. Return a code to fail. */
  inspect?: (message: BindingMessage, index: number) => string | undefined | void;
}

export interface MockBinding extends SendEmailBinding {
  /** Every message passed to `send`, in order. */
  readonly sent: BindingMessage[];
  reset(): void;
}

/** In-memory stand-in for a `send_email` binding. */
export function createMockBinding(options: MockBindingOptions = {}): MockBinding {
  const sent: BindingMessage[] = [];
  let counter = 0;
  return {
    sent,
    reset() {
      sent.length = 0;
      counter = 0;
    },
    async send(message) {
      const index = counter++;
      const msg = message as BindingMessage;
      const code = options.failWith ?? options.inspect?.(msg, index) ?? undefined;
      if (code) {
        const err = new Error(`${code}: mock failure`) as Error & { code: string };
        err.code = code;
        throw err;
      }
      sent.push(msg);
      return { messageId: options.messageId?.(index) ?? `mock-${index + 1}` };
    },
  };
}

export interface RecordedRequest {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: unknown;
}

export type MockRoute = (request: RecordedRequest) => Response | Promise<Response> | unknown;

export interface MockFetch {
  (input: RequestInfo | URL, init?: RequestInit): Promise<Response>;
  readonly calls: RecordedRequest[];
  reset(): void;
}

/** Wraps a value in a Cloudflare v4 success envelope. */
export function cfEnvelope(result: unknown, extra: Record<string, unknown> = {}): Response {
  return new Response(
    JSON.stringify({ success: true, errors: [], messages: [], result, ...extra }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
}

/** Wraps errors in a Cloudflare v4 failure envelope. */
export function cfErrorEnvelope(status: number, code: number, message: string): Response {
  return new Response(
    JSON.stringify({ success: false, errors: [{ code, message }], messages: [], result: null }),
    { status, headers: { "Content-Type": "application/json" } },
  );
}

/**
 * `fetch` replacement for REST tests. The handler returns a `Response`, or any
 * other value which is wrapped in a success envelope.
 */
export function createMockFetch(handler: MockRoute): MockFetch {
  const calls: RecordedRequest[] = [];
  const fn = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const headers: Record<string, string> = {};
    const h = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
    h.forEach((v, k) => (headers[k.toLowerCase()] = v));
    let body: unknown = undefined;
    if (typeof init?.body === "string") {
      try {
        body = JSON.parse(init.body);
      } catch {
        body = init.body;
      }
    }
    const record: RecordedRequest = { url, method: init?.method ?? "GET", headers, body };
    calls.push(record);
    const out = await handler(record);
    return out instanceof Response ? out : cfEnvelope(out);
  };
  return Object.assign(fn, {
    calls,
    reset() {
      calls.length = 0;
    },
  });
}

/** Builds a realistic Cloudflare email.sending queue event for tests. */
export function mockEmailEvent(
  type: "delivered" | "deferred" | "bounced" | "failed" | "rejected" | "complained",
  overrides: Partial<{
    messageId: string;
    recipient: string;
    sender: string;
    subject: string;
    domain: string;
    zoneId: string;
  }> = {},
) {
  const messageId = overrides.messageId ?? "0101018f7d0c4d9a-msg-test";
  const base = {
    type: `cf.email.sending.message.${type}` as const,
    source: {
      type: "email.sending" as const,
      zoneId: overrides.zoneId ?? "023e105f4ecef8ad9ca31a8372d0c353",
      domain: overrides.domain ?? "example.com",
    },
    payload: {
      eventId: `evt-${messageId}-${type}`,
      messageId,
      sender: overrides.sender ?? "noreply@example.com",
      recipient: overrides.recipient ?? "user@example.net",
      subject: overrides.subject ?? "Welcome",
      terminal: type !== "deferred",
      delivery: { status: type, smtpStatusCode: type === "delivered" ? "250" : "550" },
      ...(type === "bounced"
        ? { bounce: { type: "hard", classification: "permanent_failure", reason: "550 5.1.1 User unknown" } }
        : {}),
      ...(type === "deferred"
        ? { bounce: { type: "soft", classification: "temporary_failure", reason: "451 4.2.0 Temporary" } }
        : {}),
      ...(type === "failed" ? { failure: { reason: "delivery_failed" } } : {}),
      ...(type === "rejected" ? { rejection: { reason: "suppressed" } } : {}),
    },
    metadata: {
      accountId: "f9f79265f388666de8122cfb508d7776",
      eventSubscriptionId: "1830c4bb612e43c3af7f4cada31fbf3f",
      eventSchemaVersion: 1,
      eventTimestamp: "2026-06-01T02:48:57.132Z",
    },
  };
  return base;
}

/** Minimal `MessageBatch` double that records ack/retry calls. */
export function createMockBatch(bodies: unknown[]) {
  const acked: number[] = [];
  const retried: number[] = [];
  const messages = bodies.map((body, i) => ({
    id: `msg-${i}`,
    body,
    ack: () => acked.push(i),
    retry: () => retried.push(i),
  }));
  return { queue: "email-events", messages, acked, retried };
}
