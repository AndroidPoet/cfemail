import { describe, expect, it } from "vitest";
import { CfEmailError, isCfEmailError } from "../src";
import { fromBindingError, fromRestError } from "../src/errors";

describe("CfEmailError", () => {
  it("derives status codes and serializes", () => {
    const err = new CfEmailError("daily_limit_exceeded", "quota");
    expect(err.statusCode).toBe(429);
    expect(err instanceof Error).toBe(true);
    expect(isCfEmailError(err)).toBe(true);
    expect(err.toJSON()).toEqual({ name: "daily_limit_exceeded", message: "quota", statusCode: 429 });
  });

  it("extracts E_ codes from a message when `code` is missing", () => {
    const err = fromBindingError(new Error("send failed: E_SENDER_NOT_VERIFIED (domain)"));
    expect(err.name).toBe("sender_not_verified");
    expect(err.code).toBe("E_SENDER_NOT_VERIFIED");
  });

  it("falls back to application_error for unknown binding errors", () => {
    const err = fromBindingError("weird");
    expect(err.name).toBe("application_error");
    expect(err.message).toBe("weird");
  });

  it("uses the HTTP status when the REST code is unknown", () => {
    expect(fromRestError(403, [{ code: 99999, message: "x" }]).name).toBe("restricted_api_key");
    expect(fromRestError(503, undefined).name).toBe("service_unavailable");
    expect(fromRestError(418, undefined).name).toBe("application_error");
    expect(fromRestError(403, [{ code: 10203, message: "disabled" }]).name).toBe("sending_disabled");
  });
});
