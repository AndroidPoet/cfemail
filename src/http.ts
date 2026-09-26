import { CfEmailError, fromRestError, type CloudflareApiError } from "./errors";

export const DEFAULT_BASE_URL = "https://api.cloudflare.com/client/v4";

export interface CloudflareEnvelope<T> {
  success: boolean;
  errors: CloudflareApiError[];
  messages: unknown[];
  result: T;
  result_info?: {
    cursor?: string;
    cursors?: { after?: string; before?: string };
    page?: number;
    per_page?: number;
    count?: number;
    total_count?: number;
    [key: string]: unknown;
  };
}

export interface HttpResponse<T> {
  result: T;
  resultInfo?: CloudflareEnvelope<T>["result_info"];
  headers: Headers;
}

export interface HttpClientOptions {
  apiKey: string;
  baseUrl?: string;
  fetch?: typeof fetch;
  userAgent?: string;
}

type Query = object;

export class HttpClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly userAgent: string;

  constructor(options: HttpClientOptions) {
    this.apiKey = options.apiKey;
    this.baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
    this.fetchImpl = options.fetch ?? globalThis.fetch;
    this.userAgent = options.userAgent ?? "cfemail";
    if (typeof this.fetchImpl !== "function") {
      throw new CfEmailError("application_error", "No fetch implementation available");
    }
  }

  get<T>(path: string, query?: Query): Promise<HttpResponse<T>> {
    return this.request<T>("GET", path, { query });
  }

  post<T>(path: string, body?: unknown): Promise<HttpResponse<T>> {
    return this.request<T>("POST", path, { body });
  }

  patch<T>(path: string, body?: unknown): Promise<HttpResponse<T>> {
    return this.request<T>("PATCH", path, { body });
  }

  delete<T>(path: string): Promise<HttpResponse<T>> {
    return this.request<T>("DELETE", path, {});
  }

  async request<T>(
    method: string,
    path: string,
    init: { body?: unknown; query?: Query },
  ): Promise<HttpResponse<T>> {
    const url = new URL(this.baseUrl + path);
    for (const [key, value] of Object.entries(init.query ?? {}) as Array<[string, unknown]>) {
      if (value === undefined || value === null || value === "") continue;
      url.searchParams.set(key, String(value));
    }

    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.apiKey}`,
      Accept: "application/json",
      "User-Agent": this.userAgent,
    };
    let body: string | undefined;
    if (init.body !== undefined) {
      headers["Content-Type"] = "application/json";
      body = JSON.stringify(init.body);
    }

    let response: Response;
    try {
      response = await this.fetchImpl(url.toString(), { method, headers, body });
    } catch (cause) {
      throw new CfEmailError("network_error", `Request to ${url.pathname} failed`, { cause });
    }

    const text = await response.text();
    let envelope: Partial<CloudflareEnvelope<T>> | undefined;
    if (text) {
      try {
        envelope = JSON.parse(text) as CloudflareEnvelope<T>;
      } catch {
        envelope = undefined;
      }
    }

    if (!response.ok || envelope?.success === false) {
      throw fromRestError(
        response.status,
        envelope?.errors,
        text ? text.slice(0, 500) : `HTTP ${response.status}`,
      );
    }

    if (!envelope) {
      throw new CfEmailError("application_error", "Empty or non-JSON response from Cloudflare", {
        statusCode: response.status,
      });
    }

    const out: HttpResponse<T> = { result: envelope.result as T, headers: response.headers };
    if (envelope.result_info) out.resultInfo = envelope.result_info;
    return out;
  }
}
