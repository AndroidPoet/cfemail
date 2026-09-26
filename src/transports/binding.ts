import { fromBindingError } from "../errors";
import type { CreateEmailResponseSuccess, NormalizedMessage } from "../types";
import type { Transport, TransportResult } from "./transport";

/** Address shape the Workers binding expects. */
export interface BindingAddress {
  email: string;
  name?: string;
}

export interface BindingAttachment {
  content: string | ArrayBuffer | ArrayBufferView;
  filename: string;
  type: string;
  disposition: "attachment" | "inline";
  contentId?: string;
}

/** `EmailMessageBuilder` from the Workers API docs. */
export interface BindingMessage {
  to: BindingAddress[];
  from: BindingAddress;
  subject: string;
  html?: string;
  text?: string;
  cc?: BindingAddress[];
  bcc?: BindingAddress[];
  replyTo?: BindingAddress;
  attachments?: BindingAttachment[];
  headers?: Record<string, string>;
}

/**
 * Structural type of a `send_email` binding. Matches `SendEmail` from
 * `@cloudflare/workers-types` without depending on it.
 */
export interface SendEmailBinding {
  send(message: BindingMessage | unknown): Promise<{ messageId: string }>;
}

export function toBindingMessage(message: NormalizedMessage): BindingMessage {
  const out: BindingMessage = {
    from: message.from,
    to: message.to,
    subject: message.subject,
  };
  if (message.cc.length) out.cc = message.cc;
  if (message.bcc.length) out.bcc = message.bcc;
  if (message.replyTo) out.replyTo = message.replyTo;
  if (message.html !== undefined) out.html = message.html;
  if (message.text !== undefined) out.text = message.text;
  if (Object.keys(message.headers).length) out.headers = message.headers;
  if (message.attachments.length) {
    out.attachments = message.attachments.map((a) => {
      const attachment: BindingAttachment = {
        content: a.content,
        filename: a.filename,
        type: a.type,
        disposition: a.disposition,
      };
      if (a.contentId) attachment.contentId = a.contentId;
      return attachment;
    });
  }
  return out;
}

export class BindingTransport implements Transport {
  readonly kind = "binding" as const;

  constructor(private readonly binding: SendEmailBinding) {}

  async send(message: NormalizedMessage): Promise<TransportResult> {
    let sent: { messageId: string };
    try {
      sent = await this.binding.send(toBindingMessage(message));
    } catch (err) {
      throw fromBindingError(err);
    }
    const result: CreateEmailResponseSuccess = {
      id: sent.messageId,
      delivered: [],
      queued: [],
      permanent_bounces: [],
      suppressed_recipients: [],
    };
    return { result };
  }
}
