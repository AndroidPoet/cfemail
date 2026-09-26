export { CfEmail, type CfEmailOptions } from "./cfemail";
export {
  CfEmailError,
  isCfEmailError,
  type CfEmailErrorName,
  type CfEmailErrorJSON,
} from "./errors";
export {
  memoryIdempotencyStore,
  DEFAULT_IDEMPOTENCY_TTL_SECONDS,
  type IdempotencyStore,
} from "./idempotency";
export {
  normalizeMessage,
  normalizeAddress,
  toBase64,
  MAX_RECIPIENTS,
  MAX_ATTACHMENTS,
} from "./normalize";
export { renderReact } from "./render";
export type { Transport, TransportKind, TransportResult } from "./transports/transport";
export {
  BindingTransport,
  toBindingMessage,
  toBindingAddress,
  type SendEmailBinding,
  type BindingMessage,
} from "./transports/binding";
export { RestTransport, toRestBody, type RestSendBody } from "./transports/rest";
export { HttpClient, DEFAULT_BASE_URL } from "./http";
export { Emails } from "./resources/emails";
export { Batch } from "./resources/batch";
export { Suppressions } from "./resources/suppressions";
export { Domains } from "./resources/domains";
export {
  parseEmailEvent,
  toEmailEvent,
  isCloudflareEmailEvent,
  handleEmailEvents,
  forwardEvents,
  signWebhook,
  verifyWebhook,
  SIGNATURE_HEADER,
  TIMESTAMP_HEADER,
  EVENT_ID_HEADER,
  type CloudflareEmailEvent,
  type CloudflareEmailEventType,
  type EmailEvent,
  type EmailEventType,
  type EmailEventHandlers,
  type ForwardOptions,
  type QueueBatchLike,
  type QueueMessageLike,
} from "./resources/events";
export type * from "./types";
