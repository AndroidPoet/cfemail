import { validationError } from "./errors";
import type {
  Attachment,
  CreateEmailOptions,
  EmailAddress,
  NormalizedAddress,
  NormalizedAttachment,
  NormalizedMessage,
} from "./types";

export const MAX_RECIPIENTS = 50;
export const MAX_ATTACHMENTS = 32;

const DISPLAY_NAME_PATTERN = /^\s*(.*?)\s*<([^<>]+)>\s*$/;

export function normalizeAddress(input: EmailAddress, field: string): NormalizedAddress {
  if (typeof input === "string") {
    const trimmed = input.trim();
    if (!trimmed) throw validationError(`\`${field}\` must not be empty`);
    const match = DISPLAY_NAME_PATTERN.exec(trimmed);
    if (match) {
      const name = match[1]?.replace(/^"(.*)"$/, "$1").trim();
      const email = match[2]?.trim() ?? "";
      return name ? { email, name } : { email };
    }
    return { email: trimmed };
  }
  if (input && typeof input === "object") {
    const email = "email" in input ? input.email : "address" in input ? input.address : undefined;
    if (!email || typeof email !== "string") {
      throw validationError(`\`${field}\` must contain an email address`);
    }
    const name = input.name;
    return name ? { email: email.trim(), name } : { email: email.trim() };
  }
  throw validationError(`\`${field}\` has an unsupported shape`);
}

export function normalizeAddressList(
  input: EmailAddress | EmailAddress[] | undefined,
  field: string,
): NormalizedAddress[] {
  if (input === undefined || input === null) return [];
  const list = Array.isArray(input) ? input : [input];
  return list.map((entry) => normalizeAddress(entry, field));
}

export function toBase64(content: string | ArrayBuffer | ArrayBufferView): string {
  if (typeof content === "string") return content;
  const bytes =
    content instanceof ArrayBuffer
      ? new Uint8Array(content)
      : new Uint8Array(content.buffer, content.byteOffset, content.byteLength);
  // Chunked to keep the argument list small on large attachments.
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

export function normalizeAttachment(input: Attachment, index: number): NormalizedAttachment {
  if (!input.filename) throw validationError(`attachments[${index}].filename is required`);
  if (input.content === undefined || input.content === null) {
    throw validationError(`attachments[${index}].content is required`);
  }
  const type = input.contentType ?? input.content_type ?? input.type ?? "application/octet-stream";
  const disposition = input.disposition ?? "attachment";
  const contentId = input.contentId ?? input.content_id;
  if (disposition === "inline" && !contentId) {
    throw validationError(`attachments[${index}] is inline and needs a contentId`);
  }
  const normalized: NormalizedAttachment = {
    filename: input.filename,
    content: toBase64(input.content),
    type,
    disposition,
  };
  if (contentId) normalized.contentId = contentId;
  return normalized;
}

/**
 * Validates a Resend-shaped payload and produces the transport-agnostic
 * message. `react` must already have been rendered into `html`/`text`.
 */
export function normalizeMessage(payload: CreateEmailOptions): NormalizedMessage {
  if (!payload || typeof payload !== "object") throw validationError("payload must be an object");
  if (!payload.from) throw validationError("`from` is required");
  if (!payload.to || (Array.isArray(payload.to) && payload.to.length === 0)) {
    throw validationError("`to` is required");
  }
  if (typeof payload.subject !== "string") throw validationError("`subject` is required");
  if (!payload.html && !payload.text) {
    throw validationError("one of `html`, `text` or `react` is required");
  }

  const from = normalizeAddress(payload.from, "from");
  const to = normalizeAddressList(payload.to, "to");
  const cc = normalizeAddressList(payload.cc, "cc");
  const bcc = normalizeAddressList(payload.bcc, "bcc");
  const total = to.length + cc.length + bcc.length;
  if (total > MAX_RECIPIENTS) {
    throw validationError(
      `to + cc + bcc has ${total} recipients; Cloudflare allows at most ${MAX_RECIPIENTS}`,
    );
  }

  const replyToInput = payload.reply_to ?? payload.replyTo;
  const replyToList = normalizeAddressList(replyToInput, "reply_to");
  if (replyToList.length > 1) {
    throw validationError("Cloudflare Email Service accepts a single `reply_to` address");
  }

  const headers: Record<string, string> = {};
  for (const [key, value] of Object.entries(payload.headers ?? {})) {
    if (value === undefined || value === null) continue;
    headers[key] = String(value);
  }
  for (const tag of payload.tags ?? []) {
    if (!tag?.name) throw validationError("each tag needs a `name`");
    if (!/^[A-Za-z0-9_-]+$/.test(tag.name)) {
      throw validationError(`tag name "${tag.name}" may only contain letters, numbers, - and _`);
    }
    headers[`X-Tag-${tag.name}`] = String(tag.value ?? "");
  }

  const attachments = (payload.attachments ?? []).map(normalizeAttachment);
  if (attachments.length > MAX_ATTACHMENTS) {
    throw validationError(`Cloudflare allows at most ${MAX_ATTACHMENTS} attachments`);
  }

  const message: NormalizedMessage = {
    from,
    to,
    cc,
    bcc,
    subject: payload.subject,
    headers,
    attachments,
  };
  if (replyToList[0]) message.replyTo = replyToList[0];
  if (payload.html) message.html = payload.html;
  if (payload.text) message.text = payload.text;
  return message;
}
