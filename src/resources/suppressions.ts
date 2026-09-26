import type { ClientContext } from "../context";
import type {
  CreateSuppressionOptions,
  ImportSuppressionsOptions,
  ImportSuppressionsResponse,
  ListSuppressionsOptions,
  ListSuppressionsResponse,
  Result,
  Suppression,
  UpdateSuppressionOptions,
} from "../types";
import { toError } from "./emails";

/**
 * Account-level suppression list. Cloudflare adds bounces and complaints
 * automatically; use this to add manual entries or inspect the list.
 * REST only.
 */
export class Suppressions {
  constructor(private readonly ctx: ClientContext) {}

  private base(): string {
    return `/accounts/${encodeURIComponent(this.ctx.accountId())}/email/sending/suppressions`;
  }

  async create(options: CreateSuppressionOptions): Promise<Result<{ id: string }>> {
    try {
      const { result, headers } = await this.ctx.http().post<{ id: string }>(this.base(), options);
      return { data: result, error: null, headers };
    } catch (err) {
      return { data: null, error: toError(err) };
    }
  }

  async list(options: ListSuppressionsOptions = {}): Promise<Result<ListSuppressionsResponse>> {
    try {
      const { result, resultInfo, headers } = await this.ctx
        .http()
        .get<Suppression[]>(this.base(), options);
      const next_cursor = resultInfo?.cursors?.after ?? resultInfo?.cursor ?? null;
      return { data: { data: result ?? [], next_cursor }, error: null, headers };
    } catch (err) {
      return { data: null, error: toError(err) };
    }
  }

  async get(id: string): Promise<Result<Suppression>> {
    try {
      const { result, headers } = await this.ctx
        .http()
        .get<Suppression>(`${this.base()}/${encodeURIComponent(id)}`);
      return { data: result, error: null, headers };
    } catch (err) {
      return { data: null, error: toError(err) };
    }
  }

  async update(id: string, options: UpdateSuppressionOptions): Promise<Result<Suppression>> {
    try {
      const { result, headers } = await this.ctx
        .http()
        .patch<Suppression>(`${this.base()}/${encodeURIComponent(id)}`, options);
      return { data: result, error: null, headers };
    } catch (err) {
      return { data: null, error: toError(err) };
    }
  }

  async remove(id: string): Promise<Result<{ id: string }>> {
    try {
      const { result, headers } = await this.ctx
        .http()
        .delete<{ id: string }>(`${this.base()}/${encodeURIComponent(id)}`);
      return { data: result ?? { id }, error: null, headers };
    } catch (err) {
      return { data: null, error: toError(err) };
    }
  }

  /** Bulk add. Cloudflare accepts up to 1,000 items per request. */
  async import(options: ImportSuppressionsOptions): Promise<Result<ImportSuppressionsResponse>> {
    try {
      const { result, headers } = await this.ctx
        .http()
        .post<ImportSuppressionsResponse>(`${this.base()}/bulk`, options);
      return { data: result, error: null, headers };
    } catch (err) {
      return { data: null, error: toError(err) };
    }
  }
}
