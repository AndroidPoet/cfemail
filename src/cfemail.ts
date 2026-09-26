import type { ClientContext } from "./context";
import { CfEmailError } from "./errors";
import { HttpClient } from "./http";
import { DEFAULT_IDEMPOTENCY_TTL_SECONDS, type IdempotencyStore } from "./idempotency";
import { Batch } from "./resources/batch";
import { Domains } from "./resources/domains";
import { Emails } from "./resources/emails";
import { Suppressions } from "./resources/suppressions";
import { BindingTransport, type SendEmailBinding } from "./transports/binding";
import { RestTransport } from "./transports/rest";
import type { Transport, TransportKind } from "./transports/transport";

export interface CfEmailOptions {
  /** Cloudflare API token with `Email Sending: Edit`. Falls back to `CLOUDFLARE_API_TOKEN`. */
  apiKey?: string;
  /** Falls back to `CLOUDFLARE_ACCOUNT_ID`. Needed for REST sending and suppressions. */
  accountId?: string;
  /** Falls back to `CLOUDFLARE_ZONE_ID`. Needed for the domains resource. */
  zoneId?: string;
  /** A Workers `send_email` binding, e.g. `env.EMAIL`. Preferred for sends when present. */
  binding?: SendEmailBinding;
  /** Force a transport when both a binding and an API token are configured. */
  transport?: TransportKind;
  /** Defaults to https://api.cloudflare.com/client/v4. */
  baseUrl?: string;
  fetch?: typeof fetch;
  userAgent?: string;
  /** Enables `idempotencyKey`. A Workers `KVNamespace` works as-is. */
  idempotencyStore?: IdempotencyStore;
  /** Default 86400 (24h). */
  idempotencyTtlSeconds?: number;
}

function readEnv(name: string): string | undefined {
  const env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env;
  return env?.[name];
}

/**
 * Resend-style client for Cloudflare Email Service.
 *
 * ```ts
 * // Inside a Worker
 * const cf = new CfEmail({ binding: env.EMAIL });
 *
 * // Anywhere else
 * const cf = new CfEmail({ apiKey: "cf_token", accountId: "…" });
 *
 * const { data, error } = await cf.emails.send({ from, to, subject, html });
 * ```
 */
export class CfEmail implements ClientContext {
  readonly emails: Emails;
  readonly batch: Batch;
  readonly suppressions: Suppressions;
  readonly domains: Domains;

  readonly idempotencyStore?: IdempotencyStore;
  readonly idempotencyTtlSeconds: number;

  private readonly apiKey?: string;
  private readonly account?: string;
  private readonly zone?: string;
  private readonly binding?: SendEmailBinding;
  private readonly forcedTransport?: TransportKind;
  private readonly baseUrl?: string;
  private readonly fetchImpl?: typeof fetch;
  private readonly userAgent?: string;

  private httpClient?: HttpClient;
  private bindingTransport?: BindingTransport;
  private restTransport?: RestTransport;

  constructor(apiKeyOrOptions?: string | CfEmailOptions, extra: CfEmailOptions = {}) {
    const options: CfEmailOptions =
      typeof apiKeyOrOptions === "string"
        ? { ...extra, apiKey: apiKeyOrOptions }
        : { ...(apiKeyOrOptions ?? {}), ...extra };

    this.apiKey = options.apiKey ?? readEnv("CLOUDFLARE_API_TOKEN");
    this.account = options.accountId ?? readEnv("CLOUDFLARE_ACCOUNT_ID");
    this.zone = options.zoneId ?? readEnv("CLOUDFLARE_ZONE_ID");
    this.binding = options.binding;
    this.forcedTransport = options.transport;
    this.baseUrl = options.baseUrl ?? readEnv("CLOUDFLARE_API_BASE_URL");
    this.fetchImpl = options.fetch;
    this.userAgent = options.userAgent;
    this.idempotencyStore = options.idempotencyStore;
    this.idempotencyTtlSeconds = options.idempotencyTtlSeconds ?? DEFAULT_IDEMPOTENCY_TTL_SECONDS;

    if (this.forcedTransport === "binding" && !this.binding) {
      throw new CfEmailError("application_error", "transport is 'binding' but no `binding` was given");
    }
    if (!this.binding && !this.apiKey) {
      throw new CfEmailError(
        "missing_api_key",
        "Pass `binding: env.EMAIL` inside a Worker, or `apiKey` (or CLOUDFLARE_API_TOKEN) elsewhere",
      );
    }

    this.emails = new Emails(this);
    this.batch = new Batch(this);
    this.suppressions = new Suppressions(this);
    this.domains = new Domains(this);
  }

  /** Which transport `emails.send` will use. */
  get transportKind(): TransportKind {
    if (this.forcedTransport) return this.forcedTransport;
    return this.binding ? "binding" : "rest";
  }

  transport(): Transport {
    if (this.transportKind === "binding") {
      if (!this.bindingTransport) this.bindingTransport = new BindingTransport(this.binding!);
      return this.bindingTransport;
    }
    if (!this.restTransport) this.restTransport = new RestTransport(this.http(), this.accountId());
    return this.restTransport;
  }

  http(): HttpClient {
    if (!this.httpClient) {
      if (!this.apiKey) {
        throw new CfEmailError(
          "missing_api_key",
          "This call needs a Cloudflare API token: pass `apiKey` or set CLOUDFLARE_API_TOKEN",
        );
      }
      const opts: ConstructorParameters<typeof HttpClient>[0] = { apiKey: this.apiKey };
      if (this.baseUrl) opts.baseUrl = this.baseUrl;
      if (this.fetchImpl) opts.fetch = this.fetchImpl;
      if (this.userAgent) opts.userAgent = this.userAgent;
      this.httpClient = new HttpClient(opts);
    }
    return this.httpClient;
  }

  accountId(): string {
    if (!this.account) {
      throw new CfEmailError(
        "validation_error",
        "This call needs `accountId` (or CLOUDFLARE_ACCOUNT_ID)",
      );
    }
    return this.account;
  }

  zoneId(override?: string): string {
    const zone = override ?? this.zone;
    if (!zone) {
      throw new CfEmailError("validation_error", "This call needs `zoneId` (or CLOUDFLARE_ZONE_ID)");
    }
    return zone;
  }
}
