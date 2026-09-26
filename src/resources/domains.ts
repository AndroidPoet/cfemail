import type { ClientContext } from "../context";
import type {
  CreateDomainOptions,
  DnsRecord,
  Domain,
  Result,
  UpdateDomainOptions,
  ZoneOptions,
} from "../types";
import { toError } from "./emails";

interface RawSubdomain {
  tag: string;
  name: string;
  enabled: boolean;
  created?: string;
  modified?: string;
  dkim_selector?: string;
  return_path_domain?: string;
  drop_suppressed_recipients?: boolean;
  preview_enabled?: boolean;
}

function toDomain(raw: RawSubdomain): Domain {
  return { id: raw.tag, ...raw };
}

/**
 * Sending subdomains on a zone (`/zones/{zone_id}/email/sending/subdomains`).
 * The zone apex is onboarded from the dashboard or `wrangler email sending enable`;
 * this resource manages additional sending subdomains and reads their DNS.
 * REST only; needs `zoneId` on the client or per call.
 */
export class Domains {
  constructor(private readonly ctx: ClientContext) {}

  private base(zoneId?: string): string {
    return `/zones/${encodeURIComponent(this.ctx.zoneId(zoneId))}/email/sending/subdomains`;
  }

  async create(options: CreateDomainOptions): Promise<Result<Domain>> {
    try {
      const { zoneId, ...body } = options;
      const { result, headers } = await this.ctx.http().post<RawSubdomain>(this.base(zoneId), body);
      return { data: toDomain(result), error: null, headers };
    } catch (err) {
      return { data: null, error: toError(err) };
    }
  }

  async list(options: ZoneOptions = {}): Promise<Result<{ data: Domain[] }>> {
    try {
      const { result, headers } = await this.ctx.http().get<RawSubdomain[]>(this.base(options.zoneId));
      return { data: { data: (result ?? []).map(toDomain) }, error: null, headers };
    } catch (err) {
      return { data: null, error: toError(err) };
    }
  }

  async get(id: string, options: ZoneOptions = {}): Promise<Result<Domain>> {
    try {
      const { result, headers } = await this.ctx
        .http()
        .get<RawSubdomain>(`${this.base(options.zoneId)}/${encodeURIComponent(id)}`);
      return { data: toDomain(result), error: null, headers };
    } catch (err) {
      return { data: null, error: toError(err) };
    }
  }

  async update(id: string, options: UpdateDomainOptions): Promise<Result<Domain>> {
    try {
      const { zoneId, ...body } = options;
      const { result, headers } = await this.ctx
        .http()
        .patch<RawSubdomain>(`${this.base(zoneId)}/${encodeURIComponent(id)}`, body);
      return { data: toDomain(result), error: null, headers };
    } catch (err) {
      return { data: null, error: toError(err) };
    }
  }

  async remove(id: string, options: ZoneOptions = {}): Promise<Result<{ id: string }>> {
    try {
      const { headers } = await this.ctx
        .http()
        .delete<unknown>(`${this.base(options.zoneId)}/${encodeURIComponent(id)}`);
      return { data: { id }, error: null, headers };
    } catch (err) {
      return { data: null, error: toError(err) };
    }
  }

  /** DNS records Cloudflare wants for this sending domain (MX, SPF, DKIM, DMARC). */
  async dns(id: string, options: ZoneOptions = {}): Promise<Result<{ data: DnsRecord[] }>> {
    try {
      const { result, headers } = await this.ctx
        .http()
        .get<DnsRecord[]>(`${this.base(options.zoneId)}/${encodeURIComponent(id)}/dns`);
      return { data: { data: result ?? [] }, error: null, headers };
    } catch (err) {
      return { data: null, error: toError(err) };
    }
  }
}
