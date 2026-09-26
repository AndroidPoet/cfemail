import { describe, expect, it } from "vitest";
import { CfEmail, memoryIdempotencyStore } from "../src";
import { createMockBinding } from "../src/testing";

const base = {
  from: "Acme <hello@acme.com>",
  to: "user@example.com",
  subject: "Hi",
  html: "<p>hi</p>",
};

describe("emails.send over the Workers binding", () => {
  it("sends and returns the message id", async () => {
    const binding = createMockBinding();
    const cf = new CfEmail({ binding });
    const { data, error } = await cf.emails.send(base);
    expect(error).toBeNull();
    expect(data?.id).toBe("mock-1");
    expect(cf.transportKind).toBe("binding");
    expect(binding.sent[0]).toMatchObject({
      from: { email: "hello@acme.com", name: "Acme" },
      to: ["user@example.com"],
      subject: "Hi",
      html: "<p>hi</p>",
    });
  });

  it("maps Resend-shaped fields onto the binding shape", async () => {
    const binding = createMockBinding();
    const cf = new CfEmail({ binding });
    const { error } = await cf.emails.send({
      ...base,
      to: [{ email: "a@x.com", name: "A" }, "b@x.com"],
      cc: { address: "c@x.com", name: "C" },
      bcc: ["d@x.com"],
      reply_to: "support@acme.com",
      tags: [{ name: "campaign", value: "welcome" }],
      headers: { "X-Trace": "abc" },
      attachments: [
        { filename: "a.txt", content: new TextEncoder().encode("hello"), content_type: "text/plain" },
        { filename: "logo.png", content: "aGk=", type: "image/png", disposition: "inline", content_id: "logo" },
      ],
    });
    expect(error).toBeNull();
    const msg = binding.sent[0]!;
    expect(msg.to).toEqual([{ email: "a@x.com", name: "A" }, "b@x.com"]);
    expect(msg.cc).toEqual([{ email: "c@x.com", name: "C" }]);
    expect(msg.bcc).toEqual(["d@x.com"]);
    expect(msg.replyTo).toBe("support@acme.com");
    expect(msg.headers).toEqual({ "X-Trace": "abc", "X-Tag-campaign": "welcome" });
    expect(msg.attachments).toEqual([
      { filename: "a.txt", content: "aGVsbG8=", type: "text/plain", disposition: "attachment" },
      { filename: "logo.png", content: "aGk=", type: "image/png", disposition: "inline", contentId: "logo" },
    ]);
  });

  it("normalizes binding error codes", async () => {
    const cf = new CfEmail({ binding: createMockBinding({ failWith: "E_RECIPIENT_SUPPRESSED" }) });
    const { data, error } = await cf.emails.send(base);
    expect(data).toBeNull();
    expect(error?.name).toBe("recipient_suppressed");
    expect(error?.code).toBe("E_RECIPIENT_SUPPRESSED");
    expect(error?.statusCode).toBe(422);
    expect(error?.retryable).toBe(false);
  });

  it("marks rate limits as retryable", async () => {
    const cf = new CfEmail({ binding: createMockBinding({ failWith: "E_RATE_LIMIT_EXCEEDED" }) });
    const { error } = await cf.emails.send(base);
    expect(error?.name).toBe("rate_limit_exceeded");
    expect(error?.retryable).toBe(true);
  });

  it("validates before hitting the transport", async () => {
    const binding = createMockBinding();
    const cf = new CfEmail({ binding });
    const cases: Array<[Record<string, unknown>, string]> = [
      [{ ...base, to: [] }, "`to` is required"],
      [{ ...base, html: undefined }, "one of `html`, `text` or `react` is required"],
      [{ ...base, reply_to: ["a@x.com", "b@x.com"] }, "single `reply_to`"],
      [{ ...base, to: Array.from({ length: 51 }, (_, i) => `u${i}@x.com`) }, "at most 50"],
      [{ ...base, attachments: [{ filename: "x", content: "aGk=", disposition: "inline" }] }, "contentId"],
    ];
    for (const [payload, fragment] of cases) {
      const { error } = await cf.emails.send(payload as never);
      expect(error?.name).toBe("validation_error");
      expect(error?.message).toContain(fragment);
    }
    expect(binding.sent).toHaveLength(0);
  });

  it("replays from the idempotency store", async () => {
    const binding = createMockBinding();
    const cf = new CfEmail({ binding, idempotencyStore: memoryIdempotencyStore() });
    const first = await cf.emails.send(base, { idempotencyKey: "order-1" });
    const second = await cf.emails.send(base, { idempotencyKey: "order-1" });
    expect(first.data?.id).toBe("mock-1");
    expect(second.data?.id).toBe("mock-1");
    expect(second.data?.replayed).toBe(true);
    expect(binding.sent).toHaveLength(1);
  });

  it("refuses an idempotency key without a store", async () => {
    const cf = new CfEmail({ binding: createMockBinding() });
    const { error } = await cf.emails.send(base, { idempotencyKey: "k" });
    expect(error?.message).toContain("idempotencyStore");
  });

  it("requires a binding or an api key", () => {
    expect(() => new CfEmail({})).toThrow(/binding|apiKey/);
  });
});
