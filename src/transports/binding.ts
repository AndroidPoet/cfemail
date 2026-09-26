import { fromBindingError } from "../errors";
import type { CreateEmailResponseSuccess, NormalizedAddress, NormalizedMessage } from "../types";
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
  to: Array<string | BindingAddress>;
  from: string | BindingAddress;
  subject: string;
  html?: string;
  text?: string;
  cc?: Array<string | BindingAddress>;
  bcc?: Array<string | BindingAddress>;
  replyTo?: string | BindingAddress;
  attachments?: BindingAttachment[];
  headers?: Record<string, string>;
}

/**
 * The runtime rejects an `EmailAddress` object whose `name` is missing
 * ("Incorrect type for the 'name' field"), so unnamed addresses go as
 * plain strings. Verified live on 2026-09-26.
 */
export function toBindingAddress(address: NormalizedAddress): string | BindingAddress {
  return address.name ? { email: address.email, name: address.name } : address.email;
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
    from: toBindingAddress(message.from),
    to: message.to.map(toBindingAddress),
    subject: message.subject,
  };
  if (message.cc.length) out.cc = message.cc.map(toBindingAddress);
  if (message.bcc.length) out.bcc = message.bcc.map(toBindingAddress);
  if (message.replyTo) out.replyTo = toBindingAddress(message.replyTo);
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
