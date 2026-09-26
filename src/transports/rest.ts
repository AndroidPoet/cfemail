import type { HttpClient } from "../http";
import type { CreateEmailResponseSuccess, NormalizedAddress, NormalizedMessage } from "../types";
import type { Transport, TransportResult } from "./transport";

/** Address shape the REST API expects. */
export interface RestAddress {
  address: string;
  name?: string;
}

export interface RestAttachment {
  content: string;
  filename: string;
  type: string;
  disposition: "attachment" | "inline";
  content_id?: string;
}

/** Body of `POST /accounts/{account_id}/email/sending/send`. */
export interface RestSendBody {
  from: RestAddress;
  to: RestAddress[];
  subject: string;
  html?: string;
  text?: string;
  cc?: RestAddress[];
  bcc?: RestAddress[];
  reply_to?: RestAddress;
  headers?: Record<string, string>;
  attachments?: RestAttachment[];
}

export interface RestSendResult {
  message_id: string;
  delivered: string[];
  queued: string[];
  permanent_bounces: string[];
  suppressed_recipients: string[];
}

function toRestAddress(address: NormalizedAddress): RestAddress {
  return address.name ? { address: address.email, name: address.name } : { address: address.email };
}

export function toRestBody(message: NormalizedMessage): RestSendBody {
  const body: RestSendBody = {
    from: toRestAddress(message.from),
    to: message.to.map(toRestAddress),
    subject: message.subject,
  };
  if (message.cc.length) body.cc = message.cc.map(toRestAddress);
  if (message.bcc.length) body.bcc = message.bcc.map(toRestAddress);
  if (message.replyTo) body.reply_to = toRestAddress(message.replyTo);
  if (message.html !== undefined) body.html = message.html;
  if (message.text !== undefined) body.text = message.text;
  if (Object.keys(message.headers).length) body.headers = message.headers;
  if (message.attachments.length) {
    body.attachments = message.attachments.map((a) => {
      const attachment: RestAttachment = {
        content: a.content,
        filename: a.filename,
        type: a.type,
        disposition: a.disposition,
      };
      if (a.contentId) attachment.content_id = a.contentId;
      return attachment;
    });
  }
  return body;
}

function fromRestResult(result: RestSendResult): CreateEmailResponseSuccess {
  return {
    id: result.message_id,
    delivered: result.delivered ?? [],
    queued: result.queued ?? [],
    permanent_bounces: result.permanent_bounces ?? [],
    suppressed_recipients: result.suppressed_recipients ?? [],
  };
}

export class RestTransport implements Transport {
  readonly kind = "rest" as const;

  constructor(
    private readonly http: HttpClient,
    private readonly accountId: string,
  ) {}

  async send(message: NormalizedMessage): Promise<TransportResult> {
    const { result, headers } = await this.http.post<RestSendResult>(
      `/accounts/${encodeURIComponent(this.accountId)}/email/sending/send`,
      toRestBody(message),
    );
    return { result: fromRestResult(result), headers };
  }

  /** `POST .../send_raw` with a pre-built RFC 5322 message. */
  async sendRaw(input: {
    from: string;
    recipients: string[];
    mimeMessage: string;
  }): Promise<TransportResult> {
    const { result, headers } = await this.http.post<RestSendResult>(
      `/accounts/${encodeURIComponent(this.accountId)}/email/sending/send_raw`,
      { from: input.from, recipients: input.recipients, mime_message: input.mimeMessage },
    );
    return { result: fromRestResult(result), headers };
  }
}
