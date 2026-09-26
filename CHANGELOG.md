# Changelog

## 0.1.0 (unreleased)

Initial release.

- `CfEmail` client with two transports: Workers `send_email` binding and the REST API.
- `emails.send` with Resend-shaped payloads (`reply_to`, `tags`, `react`, binary attachments).
- `batch.send` fan-out with bounded concurrency and per-item errors.
- Client-side idempotency keys backed by any KV-like store.
- `suppressions` and `domains` (sending subdomains + DNS) resources.
- Typed Queues lifecycle events, `handleEmailEvents`, and signed webhook forwarding.
- `cfemail/testing` with a mock binding, mock fetch and event fixtures.
