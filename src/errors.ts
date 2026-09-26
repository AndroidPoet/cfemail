/**
 * One error type across both transports. The Workers binding throws `Error`
 * objects with a string `code` such as `E_RECIPIENT_SUPPRESSED`; the REST API
 * returns numeric codes such as `10004`. Both map onto `CfEmailErrorName`.
 */

export type CfEmailErrorName =
  | "validation_error"
  | "missing_required_field"
  | "missing_api_key"
  | "invalid_api_key"
  | "restricted_api_key"
  | "not_entitled"
  | "sending_disabled"
  | "not_found"
  | "rate_limit_exceeded"
  | "daily_limit_exceeded"
  | "sender_not_verified"
  | "sender_domain_not_available"
  | "recipient_not_allowed"
  | "recipient_suppressed"
  | "too_many_recipients"
  | "too_many_attachments"
  | "content_too_large"
  | "invalid_header"
  | "delivery_failed"
  | "not_implemented"
  | "application_error"
  | "internal_server_error"
  | "service_unavailable"
  | "network_error"
  | "batch_failed";

export interface CfEmailErrorJSON {
  name: CfEmailErrorName;
  message: string;
  statusCode: number;
  code?: string | number;
  details?: unknown;
}

export class CfEmailError extends Error {
  override readonly name: CfEmailErrorName;
  readonly statusCode: number;
  /** Raw Cloudflare code: `E_*` string from the binding or numeric REST code. */
  readonly code?: string | number;
  readonly details?: unknown;

  constructor(
    name: CfEmailErrorName,
    message: string,
    options: { statusCode?: number; code?: string | number; details?: unknown; cause?: unknown } = {},
  ) {
    super(message, options.cause !== undefined ? { cause: options.cause } : undefined);
    this.name = name;
    this.statusCode = options.statusCode ?? STATUS_BY_NAME[name];
    this.code = options.code;
    this.details = options.details;
    Object.setPrototypeOf(this, new.target.prototype);
  }

  /** True when retrying the same request later may succeed. */
  get retryable(): boolean {
    return (
      this.name === "rate_limit_exceeded" ||
      this.name === "internal_server_error" ||
      this.name === "service_unavailable" ||
      this.name === "network_error"
    );
  }

  toJSON(): CfEmailErrorJSON {
    const json: CfEmailErrorJSON = {
      name: this.name,
      message: this.message,
      statusCode: this.statusCode,
    };
    if (this.code !== undefined) json.code = this.code;
    if (this.details !== undefined) json.details = this.details;
    return json;
  }
}

export function isCfEmailError(value: unknown): value is CfEmailError {
  return value instanceof CfEmailError;
}

const STATUS_BY_NAME: Record<CfEmailErrorName, number> = {
  validation_error: 422,
  missing_required_field: 422,
  missing_api_key: 401,
  invalid_api_key: 401,
  restricted_api_key: 403,
  not_entitled: 403,
  sending_disabled: 403,
  not_found: 404,
  rate_limit_exceeded: 429,
  daily_limit_exceeded: 429,
  sender_not_verified: 403,
  sender_domain_not_available: 403,
  recipient_not_allowed: 403,
  recipient_suppressed: 422,
  too_many_recipients: 422,
  too_many_attachments: 422,
  content_too_large: 413,
  invalid_header: 422,
  delivery_failed: 502,
  not_implemented: 501,
  application_error: 500,
  internal_server_error: 500,
  service_unavailable: 503,
  network_error: 0,
  batch_failed: 500,
};

/** Workers binding `code` values, from developers.cloudflare.com/email-service/api/send-emails/workers-api/. */
const BINDING_CODES: Record<string, CfEmailErrorName> = {
  E_VALIDATION_ERROR: "validation_error",
  E_FIELD_MISSING: "missing_required_field",
  E_TOO_MANY_RECIPIENTS: "too_many_recipients",
  E_TOO_MANY_ATTACHMENTS: "too_many_attachments",
  E_SENDER_NOT_VERIFIED: "sender_not_verified",
  E_RECIPIENT_NOT_ALLOWED: "recipient_not_allowed",
  E_RECIPIENT_SUPPRESSED: "recipient_suppressed",
  E_SENDER_DOMAIN_NOT_AVAILABLE: "sender_domain_not_available",
  E_CONTENT_TOO_LARGE: "content_too_large",
  E_DELIVERY_FAILED: "delivery_failed",
  E_RATE_LIMIT_EXCEEDED: "rate_limit_exceeded",
  E_DAILY_LIMIT_EXCEEDED: "daily_limit_exceeded",
  E_INTERNAL_SERVER_ERROR: "internal_server_error",
  E_HEADER_NOT_ALLOWED: "invalid_header",
  E_HEADER_USE_API_FIELD: "invalid_header",
  E_HEADER_VALUE_INVALID: "invalid_header",
  E_HEADER_VALUE_TOO_LONG: "invalid_header",
  E_HEADER_NAME_INVALID: "invalid_header",
  E_HEADERS_TOO_LARGE: "invalid_header",
  E_HEADERS_TOO_MANY: "invalid_header",
};

/** REST error codes, from developers.cloudflare.com/email-service/api/send-emails/rest-api/. */
const REST_CODES: Record<number, CfEmailErrorName> = {
  10000: "not_found",
  10001: "validation_error",
  10002: "internal_server_error",
  10003: "not_implemented",
  10004: "rate_limit_exceeded",
  10100: "service_unavailable",
  10101: "invalid_api_key",
  10102: "restricted_api_key",
  10103: "invalid_api_key",
  10105: "not_entitled",
  10200: "content_too_large",
  10201: "validation_error",
  10202: "validation_error",
  10203: "sending_disabled",
};

const NAME_BY_STATUS: Record<number, CfEmailErrorName> = {
  400: "validation_error",
  401: "invalid_api_key",
  403: "restricted_api_key",
  404: "not_found",
  413: "content_too_large",
  422: "validation_error",
  429: "rate_limit_exceeded",
  500: "internal_server_error",
  501: "not_implemented",
  502: "internal_server_error",
  503: "service_unavailable",
};

const E_CODE_PATTERN = /\bE_[A-Z_]+\b/;

/** Wraps whatever the `send_email` binding threw. */
export function fromBindingError(err: unknown): CfEmailError {
  if (isCfEmailError(err)) return err;
  const message = err instanceof Error ? err.message : String(err);
  const rawCode =
    typeof err === "object" && err !== null && "code" in err
      ? (err as { code?: unknown }).code
      : undefined;
  let code = typeof rawCode === "string" ? rawCode : undefined;
  if (!code) {
    const match = E_CODE_PATTERN.exec(message);
    if (match) code = match[0];
  }
  const name: CfEmailErrorName = (code && BINDING_CODES[code]) || "application_error";
  return new CfEmailError(name, message, { code, cause: err });
}

export interface CloudflareApiError {
  code: number;
  message: string;
  documentation_url?: string;
  source?: { pointer?: string };
}

/** Builds an error from a Cloudflare v4 envelope response. */
export function fromRestError(
  statusCode: number,
  errors: CloudflareApiError[] | undefined,
  fallbackMessage = "Request failed",
): CfEmailError {
  const first = errors?.[0];
  const code = first?.code;
  const name: CfEmailErrorName =
    (code !== undefined && REST_CODES[code]) ||
    NAME_BY_STATUS[statusCode] ||
    (statusCode >= 500 ? "internal_server_error" : "application_error");
  const message = first?.message ?? fallbackMessage;
  return new CfEmailError(name, message, { statusCode, code, details: errors });
}

export function validationError(message: string, details?: unknown): CfEmailError {
  return new CfEmailError("validation_error", message, { details });
}
