import { describe, expect, it } from "vitest";
import {
  SIGNATURE_HEADER,
  forwardEvents,
  handleEmailEvents,
  parseEmailEvent,
  signWebhook,
  verifyWebhook,
} from "../src";
import { createMockBatch, createMockFetch, mockEmailEvent } from "../src/testing";

describe("events", () => {
  it("converts Cloudflare queue events into Resend-shaped events", () => {
    const ev = parseEmailEvent(mockEmailEvent("bounced", { recipient: "gone@x.com" }));
    expect(ev.type).toBe("email.bounced");
    expect(ev.data.email_id).toBe("0101018f7d0c4d9a-msg-test");
    expect(ev.data.to).toEqual(["gone@x.com"]);
    expect(ev.data.bounce?.type).toBe("hard");
    expect(ev.data.terminal).toBe(true);
    expect(ev.created_at).toBe("2026-06-01T02:48:57.132Z");
    expect(ev.raw.type).toBe("cf.email.sending.message.bounced");
  });

  it("accepts JSON strings and rejects other messages", () => {
    const ev = parseEmailEvent(JSON.stringify(mockEmailEvent("deferred")));
    expect(ev.type).toBe("email.delivery_delayed");
    expect(() => parseEmailEvent({ type: "cf.r2.object.created" })).toThrow(/email.sending/);
  });

  it("dispatches a batch to handlers, acking and retrying", async () => {
    const batch = createMockBatch([
      mockEmailEvent("delivered"),
      mockEmailEvent("complained"),
      { type: "something.else" },
      mockEmailEvent("failed"),
    ]);
    const seen: string[] = [];
    const stats = await handleEmailEvents(batch, {
      "email.delivered": (e) => void seen.push(e.type),
      "email.complained": () => {
        throw new Error("boom");
      },
      onEvent: (e) => void seen.push(`any:${e.type}`),
    });
    expect(stats).toEqual({ handled: 2, unknown: 1, failed: 1 });
    expect(seen).toEqual(["email.delivered", "any:email.delivered", "any:email.failed"]);
    expect(batch.acked).toEqual([0, 2, 3]);
    expect(batch.retried).toEqual([1]);
  });
});

describe("webhooks", () => {
  it("signs and verifies", async () => {
    const body = JSON.stringify({ hello: "world" });
    const sig = await signWebhook(body, "secret", 1_700_000_000);
    expect(sig).toMatch(/^t=1700000000,v1=[0-9a-f]{64}$/);
    expect(await verifyWebhook(body, sig, "secret", { now: 1_700_000_010 })).toBe(true);
    expect(await verifyWebhook(body + " ", sig, "secret", { now: 1_700_000_010 })).toBe(false);
    expect(await verifyWebhook(body, sig, "other", { now: 1_700_000_010 })).toBe(false);
    expect(await verifyWebhook(body, sig, "secret", { now: 1_700_001_000 })).toBe(false);
    expect(await verifyWebhook(body, null, "secret")).toBe(false);
  });

  it("forwards events over HTTP with a signature", async () => {
    const received: Array<{ body: unknown; sig: string }> = [];
    const fetch = createMockFetch((req) => {
      received.push({ body: req.body, sig: req.headers[SIGNATURE_HEADER]! });
      return new Response("ok", { status: 200 });
    });
    const batch = createMockBatch([mockEmailEvent("delivered"), { nope: true }]);
    const stats = await forwardEvents(batch, { url: "https://app.test/hook", secret: "s", fetch });
    expect(stats).toEqual({ delivered: 1, failed: 0, skipped: 1 });
    expect(batch.acked).toEqual([0, 1]);
    const first = received[0]!;
    expect((first.body as { type: string }).type).toBe("email.delivered");
    expect((first.body as Record<string, unknown>).raw).toBeUndefined();
    const rawBody = JSON.stringify(first.body);
    expect(await verifyWebhook(rawBody, first.sig, "s")).toBe(true);
  });

  it("retries when the endpoint fails", async () => {
    const fetch = createMockFetch(() => new Response("nope", { status: 500 }));
    const batch = createMockBatch([mockEmailEvent("delivered")]);
    const stats = await forwardEvents(batch, { url: "https://app.test/hook", secret: "s", fetch });
    expect(stats.failed).toBe(1);
    expect(batch.retried).toEqual([0]);
  });
});
