import type { ClientContext } from "../context";
import { CfEmailError } from "../errors";
import type {
  BatchSendOptions,
  BatchSendResponse,
  CreateEmailOptions,
  NormalizedMessage,
  Result,
} from "../types";
import { Emails, prepareMessage, toError } from "./emails";

/**
 * Cloudflare has no batch endpoint, so this fans out over the single-send
 * transport with bounded concurrency. Results keep input order.
 */
export class Batch {
  private readonly emails: Emails;

  constructor(private readonly ctx: ClientContext) {
    this.emails = new Emails(ctx);
  }

  async send(
    payloads: CreateEmailOptions[],
    options: BatchSendOptions = {},
  ): Promise<Result<BatchSendResponse>> {
    if (!Array.isArray(payloads) || payloads.length === 0) {
      return {
        data: null,
        error: new CfEmailError("validation_error", "batch.send expects a non-empty array"),
      };
    }

    const concurrency = Math.max(1, Math.floor(options.concurrency ?? 5));
    const data: BatchSendResponse["data"] = new Array(payloads.length).fill(null);
    const errors: BatchSendResponse["errors"] = [];
    let stopped = false;
    let next = 0;

    const worker = async () => {
      while (!stopped) {
        const index = next++;
        if (index >= payloads.length) return;
        const payload = payloads[index] as CreateEmailOptions;
        try {
          const message: NormalizedMessage = await prepareMessage(payload);
          const requestOptions = options.idempotencyKey
            ? { idempotencyKey: `${options.idempotencyKey}:${index}` }
            : {};
          const { result } = await this.emails.sendPrepared(message, requestOptions);
          data[index] = { id: result.id };
        } catch (err) {
          errors.push({ index, error: toError(err) });
          if (options.stopOnError) stopped = true;
        }
      }
    };

    await Promise.all(Array.from({ length: Math.min(concurrency, payloads.length) }, worker));
    errors.sort((a, b) => a.index - b.index);

    if (errors.length === payloads.length) {
      return {
        data: { data, errors },
        error: new CfEmailError("batch_failed", `All ${payloads.length} sends failed`, {
          details: errors.map((e) => ({ index: e.index, error: e.error.toJSON() })),
        }),
      };
    }
    return { data: { data, errors }, error: null };
  }

  /** Alias of `send`, matching Resend. */
  create(payloads: CreateEmailOptions[], options?: BatchSendOptions) {
    return this.send(payloads, options);
  }
}
