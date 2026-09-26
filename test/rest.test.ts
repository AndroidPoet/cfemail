import { describe, expect, it } from "vitest";
import { CfEmail } from "../src";
import { cfErrorEnvelope, createMockFetch } from "../src/testing";

const ACCOUNT = "acc123";
const ZONE = "zone456";

describe("REST transport", () => {
  it("posts a Cloudflare-shaped body to /email/sending/send", async () => {
    const fetch = createMockFetch(() => ({
      message_id: "cf-msg-1",
      delivered: ["user@example.com"],
      queued: [],
      permanent_bounces: [],
      suppressed_recipients: [],
    }));
    const cf = new CfEmail({ apiKey: "tok", accountId: ACCOUNT, fetch });
    const { data, error, headers } = await cf.emails.send({
      from: { email: "hello@acme.com", name: "Acme" },
      to: ["a@x.com", { email: "b@x.com", name: "B" }],
      reply_to: "support@acme.com",
      subject: "Hi",
      text: "hi",
      tags: [{ name: "t", value: "v" }],
      attachments: [{ filename: "a.txt", content: "aGk=", contentType: "text/plain" }],
    });
    expect(error).toBeNull();
    expect(headers).toBeInstanceOf(Headers);
    expect(data).toEqual({
      id: "cf-msg-1",
      delivered: ["user@example.com"],
      queued: [],
      permanent_bounces: [],
      suppressed_recipients: [],
    });
    const call = fetch.calls[0]!;
    expect(call.url).toBe(`https://api.cloudflare.com/client/v4/accounts/${ACCOUNT}/email/sending/send`);
    expect(call.method).toBe("POST");
    expect(call.headers.authorization).toBe("Bearer tok");
    expect(call.body).toEqual({
      from: { address: "hello@acme.com", name: "Acme" },
      to: [{ address: "a@x.com" }, { address: "b@x.com", name: "B" }],
      reply_to: { address: "support@acme.com" },
      subject: "Hi",
      text: "hi",
      headers: { "X-Tag-t": "v" },
      attachments: [{ content: "aGk=", filename: "a.txt", type: "text/plain", disposition: "attachment" }],
    });
  });

  it("maps numeric REST error codes", async () => {
    const fetch = createMockFetch(() =>
      cfErrorEnvelope(429, 10004, "email.sending.error.throttled"),
    );
    const cf = new CfEmail("tok", { accountId: ACCOUNT, fetch });
    const { error } = await cf.emails.send({ from: "a@b.c", to: "d@e.f", subject: "s", text: "t" });
    expect(error?.name).toBe("rate_limit_exceeded");
    expect(error?.code).toBe(10004);
    expect(error?.statusCode).toBe(429);
    expect(error?.message).toBe("email.sending.error.throttled");
  });

  it("maps auth failures", async () => {
    const fetch = createMockFetch(() =>
      cfErrorEnvelope(401, 10101, "email.sending.error.authentication.unauthorized"),
    );
    const cf = new CfEmail({ apiKey: "bad", accountId: ACCOUNT, fetch });
    const { error } = await cf.emails.send({ from: "a@b.c", to: "d@e.f", subject: "s", text: "t" });
    expect(error?.name).toBe("invalid_api_key");
  });

  it("surfaces network failures", async () => {
    const fetch = createMockFetch(() => {
      throw new TypeError("fetch failed");
    });
    const cf = new CfEmail({ apiKey: "tok", accountId: ACCOUNT, fetch });
    const { error } = await cf.emails.send({ from: "a@b.c", to: "d@e.f", subject: "s", text: "t" });
    expect(error?.name).toBe("network_error");
    expect(error?.retryable).toBe(true);
  });

  it("needs an account id for REST sends", async () => {
    const cf = new CfEmail({ apiKey: "tok", fetch: createMockFetch(() => ({})) });
    const { error } = await cf.emails.send({ from: "a@b.c", to: "d@e.f", subject: "s", text: "t" });
    expect(error?.message).toContain("accountId");
  });

  it("prefers the binding but can be forced to REST", async () => {
    const fetch = createMockFetch(() => ({ message_id: "rest-1" }));
    const binding = { send: async () => ({ messageId: "bind-1" }) };
    const auto = new CfEmail({ binding, apiKey: "tok", accountId: ACCOUNT, fetch });
    const forced = new CfEmail({ binding, apiKey: "tok", accountId: ACCOUNT, fetch, transport: "rest" });
    const payload = { from: "a@b.c", to: "d@e.f", subject: "s", text: "t" };
    expect((await auto.emails.send(payload)).data?.id).toBe("bind-1");
    expect((await forced.emails.send(payload)).data?.id).toBe("rest-1");
  });
});

describe("suppressions", () => {
  it("creates, lists with cursor, updates and removes", async () => {
    const fetch = createMockFetch((req) => {
      if (req.method === "POST" && req.url.endsWith("/suppressions")) return { id: "sup-1" };
      if (req.method === "GET" && req.url.includes("/suppressions?")) {
        return new Response(
          JSON.stringify({
            success: true,
            errors: [],
            messages: [],
            result: [{ id: "sup-1", email: "x@y.z", reason: "manual", created_at: "", expires_at: null, read_only: false }],
            result_info: { cursors: { after: "next-page" } },
          }),
          { status: 200 },
        );
      }
      if (req.method === "PATCH") return { id: "sup-1", note: "updated" };
      if (req.method === "DELETE") return { id: "sup-1" };
      if (req.url.endsWith("/bulk")) return { total: 2, processed: 2, deduplicated: 0, invalid: 0, skipped: 0, errors: 0, items: [] };
      return { id: "sup-1", email: "x@y.z" };
    });
    const cf = new CfEmail({ apiKey: "tok", accountId: ACCOUNT, fetch });

    const created = await cf.suppressions.create({ email: "x@y.z", note: "unsubscribed" });
    expect(created.data).toEqual({ id: "sup-1" });
    expect(fetch.calls[0]?.body).toEqual({ email: "x@y.z", note: "unsubscribed" });

    const listed = await cf.suppressions.list({ reason: "manual", per_page: 10 });
    expect(listed.data?.data[0]?.email).toBe("x@y.z");
    expect(listed.data?.next_cursor).toBe("next-page");
    expect(fetch.calls[1]?.url).toContain("reason=manual");
    expect(fetch.calls[1]?.url).toContain("per_page=10");

    const got = await cf.suppressions.get("sup-1");
    expect(got.data?.id).toBe("sup-1");

    const updated = await cf.suppressions.update("sup-1", { note: "updated" });
    expect(updated.data?.note).toBe("updated");

    const removed = await cf.suppressions.remove("sup-1");
    expect(removed.data).toEqual({ id: "sup-1" });

    const imported = await cf.suppressions.import({ items: [{ email: "a@b.c" }, { email: "d@e.f" }] });
    expect(imported.data?.processed).toBe(2);
    expect(fetch.calls.at(-1)?.url).toMatch(/\/suppressions\/bulk$/);
  });
});

describe("domains", () => {
  it("manages sending subdomains on a zone", async () => {
    const sub = { tag: "sd-1", name: "send.example.com", enabled: true, dkim_selector: "cf-bounce" };
    const fetch = createMockFetch((req) => {
      if (req.url.endsWith("/dns")) return [{ type: "TXT", name: "cf-bounce.send.example.com", content: "v=spf1 …" }];
      if (req.method === "GET" && req.url.endsWith("/subdomains")) return [sub];
      if (req.method === "DELETE") return new Response(JSON.stringify({ success: true, errors: [], messages: [], result: null }));
      return sub;
    });
    const cf = new CfEmail({ apiKey: "tok", accountId: ACCOUNT, zoneId: ZONE, fetch });

    const created = await cf.domains.create({ name: "send.example.com" });
    expect(created.data?.id).toBe("sd-1");
    expect(fetch.calls[0]?.url).toBe(`https://api.cloudflare.com/client/v4/zones/${ZONE}/email/sending/subdomains`);
    expect(fetch.calls[0]?.body).toEqual({ name: "send.example.com" });

    const listed = await cf.domains.list();
    expect(listed.data?.data).toHaveLength(1);

    const updated = await cf.domains.update("sd-1", { drop_suppressed_recipients: true, zoneId: "other" });
    expect(updated.data?.name).toBe("send.example.com");
    expect(fetch.calls.at(-1)?.url).toContain("/zones/other/");
    expect(fetch.calls.at(-1)?.body).toEqual({ drop_suppressed_recipients: true });

    const dns = await cf.domains.dns("sd-1");
    expect(dns.data?.data[0]?.type).toBe("TXT");

    const removed = await cf.domains.remove("sd-1");
    expect(removed.data).toEqual({ id: "sd-1" });
  });

  it("fails clearly without a zone id", async () => {
    const cf = new CfEmail({ apiKey: "tok", accountId: ACCOUNT, fetch: createMockFetch(() => ({})) });
    const { error } = await cf.domains.list();
    expect(error?.message).toContain("zoneId");
  });
});
