import type { ClientContext } from "../context";
import { CfEmailError, isCfEmailError } from "../errors";
import { idempotencyStorageKey } from "../idempotency";
import { normalizeMessage } from "../normalize";
import { renderReact } from "../render";
import type {
  CreateEmailOptions,
  CreateEmailResponseSuccess,
  NormalizedMessage,
  RequestOptions,
  Result,
} from "../types";

export function toError(err: unknown): CfEmailError {
  if (isCfEmailError(err)) return err;
  const message = err instanceof Error ? err.message : String(err);
  return new CfEmailError("application_error", message, { cause: err });
}

/** Renders `react` if present and validates the payload into a transport message. */
export async function prepareMessage(payload: CreateEmailOptions): Promise<NormalizedMessage> {
  let effective = payload;
  if (payload.react !== undefined && payload.react !== null) {
    const rendered = await renderReact(payload.react);
    effective = {
      ...payload,
      html: payload.html ?? rendered.html,
      text: payload.text ?? rendered.text,
    };
  }
  return normalizeMessage(effective);
}

export class Emails {
  constructor(private readonly ctx: ClientContext) {}

  /**
   * Sends one email. Mirrors `resend.emails.send()`.
   *
   * ```ts
   * const { data, error } = await cf.emails.send({
   *   from: "Acme <hello@acme.com>",
   *   to: ["user@example.com"],
   *   subject: "Hello",
   *   html: "<p>Hi</p>",
   * });
   * ```
   */
  async send(
    payload: CreateEmailOptions,
    options: RequestOptions = {},
  ): Promise<Result<CreateEmailResponseSuccess>> {
    try {
      const message = await prepareMessage(payload);
      const { result, headers } = await this.sendPrepared(message, options);
      const out: Result<CreateEmailResponseSuccess> = { data: result, error: null };
      if (headers) out.headers = headers;
      return out;
    } catch (err) {
      return { data: null, error: toError(err) };
    }
  }

  /** Alias of `send`, matching Resend. */
  create(
    payload: CreateEmailOptions,
    options: RequestOptions = {},
  ): Promise<Result<CreateEmailResponseSuccess>> {
    return this.send(payload, options);
  }

  /** Internal: send an already-normalized message, honouring idempotency. */
  async sendPrepared(
    message: NormalizedMessage,
    options: RequestOptions = {},
  ): Promise<{ result: CreateEmailResponseSuccess; headers?: Headers }> {
    const key = options.idempotencyKey;
    const store = this.ctx.idempotencyStore;

    if (key && !store) {
      throw new CfEmailError(
        "application_error",
        "idempotencyKey was given but the client has no `idempotencyStore` (pass a KVNamespace or memoryIdempotencyStore())",
      );
    }

    if (key && store) {
      const cached = await store.get(idempotencyStorageKey(key));
      if (cached) {
        const parsed = JSON.parse(cached) as CreateEmailResponseSuccess;
        return { result: { ...parsed, replayed: true } };
      }
    }

    const sent = await this.ctx.transport().send(message);

    if (key && store) {
      await store.put(idempotencyStorageKey(key), JSON.stringify(sent.result), {
        expirationTtl: this.ctx.idempotencyTtlSeconds,
      });
    }
    return sent;
  }
}
