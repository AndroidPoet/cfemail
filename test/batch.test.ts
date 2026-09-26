import { describe, expect, it } from "vitest";
import { CfEmail } from "../src";
import { createMockBinding } from "../src/testing";

const mk = (i: number) => ({
  from: "hello@acme.com",
  to: `u${i}@example.com`,
  subject: `Mail ${i}`,
  text: "hi",
});

describe("batch.send", () => {
  it("sends every payload and keeps order", async () => {
    const binding = createMockBinding();
    const cf = new CfEmail({ binding });
    const { data, error } = await cf.batch.send([mk(0), mk(1), mk(2)], { concurrency: 2 });
    expect(error).toBeNull();
    expect(data?.data.map((d) => d?.id)).toEqual(["mock-1", "mock-2", "mock-3"]);
    expect(data?.errors).toEqual([]);
    expect(binding.sent.map((m) => m.to[0])).toEqual([
      "u0@example.com",
      "u1@example.com",
      "u2@example.com",
    ]);
  });

  it("reports partial failures without failing the batch", async () => {
    const binding = createMockBinding({
      inspect: (msg) => (msg.to[0] === "u1@example.com" ? "E_RECIPIENT_SUPPRESSED" : undefined),
    });
    const cf = new CfEmail({ binding });
    const { data, error } = await cf.batch.send([mk(0), mk(1), mk(2)]);
    expect(error).toBeNull();
    expect(data?.data[1]).toBeNull();
    expect(data?.errors).toHaveLength(1);
    expect(data?.errors[0]?.index).toBe(1);
    expect(data?.errors[0]?.error.name).toBe("recipient_suppressed");
  });

  it("returns batch_failed when everything fails", async () => {
    const cf = new CfEmail({ binding: createMockBinding({ failWith: "E_DAILY_LIMIT_EXCEEDED" }) });
    const { data, error } = await cf.batch.send([mk(0), mk(1)]);
    expect(error?.name).toBe("batch_failed");
    expect(data?.errors).toHaveLength(2);
  });

  it("stops scheduling after the first error with stopOnError", async () => {
    const binding = createMockBinding({ inspect: (_m, i) => (i === 0 ? "E_VALIDATION_ERROR" : undefined) });
    const cf = new CfEmail({ binding });
    const { data } = await cf.batch.send([mk(0), mk(1), mk(2), mk(3)], {
      concurrency: 1,
      stopOnError: true,
    });
    expect(data?.errors.map((e) => e.index)).toEqual([0]);
    expect(binding.sent).toHaveLength(0);
    expect(data?.data.filter(Boolean)).toHaveLength(0);
  });

  it("rejects an empty array", async () => {
    const cf = new CfEmail({ binding: createMockBinding() });
    const { error } = await cf.batch.send([]);
    expect(error?.name).toBe("validation_error");
  });
});
