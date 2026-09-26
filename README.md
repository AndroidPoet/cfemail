# cfemail

Resend-style SDK for [Cloudflare Email Service](https://developers.cloudflare.com/email-service/).

One client that sends through the Workers `send_email` binding inside a Worker and through the REST API everywhere else, with the pieces Cloudflare does not ship yet: batch sending, idempotency keys, React Email rendering, typed lifecycle events, and signed webhooks.

```ts
import { CfEmail } from "cfemail";

// In a Worker
const cf = new CfEmail({ binding: env.EMAIL });

// In Node, Bun, Deno, or anywhere with fetch
const cf = new CfEmail({ apiKey: process.env.CLOUDFLARE_API_TOKEN, accountId: "…" });

const { data, error } = await cf.emails.send({
  from: "Acme <hello@acme.com>",
  to: ["user@example.com"],
  subject: "Welcome",
  html: "<h1>Hi</h1>",
});
```

Every call returns `{ data, error }` exactly like the Resend SDK, so swapping `new Resend(key)` for `new CfEmail({...})` is usually the only change.

## Install

```sh
npm install cfemail
# optional, only if you pass `react:`
npm install @react-email/render
```

Runs on Workers, Node 18+, Bun and Deno. Zero runtime dependencies.

## Which transport?

| You are in | Configure | Sends via |
|---|---|---|
| A Worker with `send_email` binding | `new CfEmail({ binding: env.EMAIL })` | Binding |
| Anywhere else | `new CfEmail({ apiKey, accountId })` | `POST /accounts/{id}/email/sending/send` |
| Both configured | binding wins; pass `transport: "rest"` to override | |

`apiKey`, `accountId` and `zoneId` fall back to `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_ZONE_ID`. The token needs the **Email Sending: Edit** permission.

The `suppressions` and `domains` resources are REST only and need an API token even inside a Worker.

## Sending

```ts
await cf.emails.send({
  from: { email: "hello@acme.com", name: "Acme" },
  to: ["a@example.com", { email: "b@example.com", name: "B" }],
  cc: "c@example.com",
  bcc: ["d@example.com"],
  reply_to: "support@acme.com",
  subject: "Invoice",
  html: "<p>Attached</p>",
  text: "Attached",
  headers: { "List-Unsubscribe": "<https://acme.com/u/123>" },
  tags: [{ name: "category", value: "invoice" }], // sent as X-Tag-category
  attachments: [
    { filename: "invoice.pdf", content: pdfBytes, contentType: "application/pdf" },
    { filename: "logo.png", content: base64, contentType: "image/png", disposition: "inline", contentId: "logo" },
  ],
});
```

Accepted address shapes: `"a@b.c"`, `"Name <a@b.c>"`, `{ email, name }` (Resend / Workers) and `{ address, name }` (Cloudflare REST). Attachment content may be a base64 string, `ArrayBuffer`, or any typed array.

Limits enforced client-side before the network: 50 recipients across to/cc/bcc, 32 attachments, one `reply_to`.

### React Email

```ts
await cf.emails.send({ from, to, subject, react: <Welcome name="Ann" /> });
```

Renders `html` and plain `text` with `@react-email/render`.

### Idempotency

Cloudflare has no server-side idempotency key. The client emulates one with any KV-like store. A Workers `KVNamespace` works unchanged:

```ts
const cf = new CfEmail({ binding: env.EMAIL, idempotencyStore: env.KV });
await cf.emails.send(payload, { idempotencyKey: `order-${orderId}` });
// second call within 24h returns the cached { id, replayed: true } without sending
```

Use `memoryIdempotencyStore()` from `cfemail` for single-process Node apps and tests.

### Batch

```ts
const { data, error } = await cf.batch.send(emails, { concurrency: 5 });
data.data   // [{ id }, null, { id }] in input order
data.errors // [{ index: 1, error: CfEmailError }]
```

Cloudflare has no batch endpoint, so this fans out over the single-send path. Partial failures come back per item; `error` is only set when every send failed.

## Suppressions

```ts
await cf.suppressions.create({ email: "gone@example.com", note: "unsubscribed" });
const { data } = await cf.suppressions.list({ reason: "hard_bounce" });
await cf.suppressions.update(id, { expires_at: null });
await cf.suppressions.remove(id);
await cf.suppressions.import({ items: [{ email: "a@b.c" }, { email: "d@e.f" }] });
```

Cloudflare adds bounces and complaints to this list automatically.

## Domains

Manages sending subdomains on a zone (`/zones/{zone_id}/email/sending/subdomains`). The zone apex is onboarded from the dashboard or `wrangler email sending enable <domain>`.

```ts
const cf = new CfEmail({ apiKey, accountId, zoneId });
const { data: domain } = await cf.domains.create({ name: "send.acme.com" });
const { data: dns } = await cf.domains.dns(domain.id); // MX, SPF, DKIM, DMARC records
await cf.domains.update(domain.id, { drop_suppressed_recipients: true });
```

## Events and webhooks

Cloudflare publishes delivery events only through [Queues event subscriptions](https://developers.cloudflare.com/email-service/platform/event-subscriptions/). `cfemail` types them and maps them to Resend event names:

| Cloudflare | cfemail |
|---|---|
| `message.delivered` | `email.delivered` |
| `message.deferred` | `email.delivery_delayed` |
| `message.bounced` | `email.bounced` |
| `message.failed` | `email.failed` |
| `message.rejected` | `email.rejected` |
| `message.complained` | `email.complained` |

```ts
import { handleEmailEvents, forwardEvents } from "cfemail";

export default {
  async queue(batch, env) {
    // handle in the Worker
    await handleEmailEvents(batch, {
      "email.bounced": (e) => markBounced(e.data.to[0], e.data.bounce),
      "email.complained": (e) => unsubscribe(e.data.to[0]),
    });

    // or forward as signed HTTP webhooks
    await forwardEvents(batch, { url: env.WEBHOOK_URL, secret: env.WEBHOOK_SECRET });
  },
};
```

Forwarded requests carry `cfemail-signature: t=<unix>,v1=<hmac-sha256>`. Verify on the receiving side:

```ts
import { verifyWebhook } from "cfemail";
const ok = await verifyWebhook(rawBody, req.headers.get("cfemail-signature"), secret);
```

## Errors

`error` is always a `CfEmailError` with a stable `name`, the original Cloudflare `code`, and an HTTP-style `statusCode`. Binding codes (`E_RECIPIENT_SUPPRESSED`) and REST codes (`10004`) map onto the same names.

```ts
if (error?.name === "recipient_suppressed") …
if (error?.retryable) …   // rate limits, 5xx, network
```

Names: `validation_error`, `missing_required_field`, `missing_api_key`, `invalid_api_key`, `restricted_api_key`, `not_entitled`, `sending_disabled`, `not_found`, `rate_limit_exceeded`, `daily_limit_exceeded`, `sender_not_verified`, `sender_domain_not_available`, `recipient_not_allowed`, `recipient_suppressed`, `too_many_recipients`, `too_many_attachments`, `content_too_large`, `invalid_header`, `delivery_failed`, `not_implemented`, `application_error`, `internal_server_error`, `service_unavailable`, `network_error`, `batch_failed`.

## Testing

```ts
import { createMockBinding, createMockFetch, mockEmailEvent } from "cfemail/testing";

const binding = createMockBinding();
const cf = new CfEmail({ binding });
await cf.emails.send(payload);
expect(binding.sent[0].subject).toBe("Welcome");

const failing = createMockBinding({ failWith: "E_DAILY_LIMIT_EXCEEDED" });
```

## Resend feature map

| Resend | cfemail | Notes |
|---|---|---|
| `emails.send` | ✅ | `react`, `tags`, `reply_to`, binary attachments |
| `batch.send` | ✅ | client-side fan-out |
| `Idempotency-Key` | ✅ | client-side, KV backed |
| `emails.get/list/update/cancel` | ❌ | no Cloudflare API for these |
| `scheduled_at` | ❌ | use Queues delay or Workflows |
| Templates | ❌ | render with React Email instead |
| `domains.*` | ✅ | sending subdomains + DNS on a zone |
| `apiKeys.*` | ❌ | use Cloudflare API tokens |
| Audiences / Contacts / Broadcasts | ❌ | Cloudflare is transactional-only for now |
| Webhooks | ✅ | Queues subscription → signed HTTP forward |
| Suppressions | ✅ | richer than Resend: TTL, bulk import, auto bounce/complaint |

## Example Worker

`examples/worker` exposes `POST /emails` and `POST /emails/batch` over the binding and a queue consumer that forwards events. Run with `wrangler dev` after filling in the KV id.

## License

MIT
