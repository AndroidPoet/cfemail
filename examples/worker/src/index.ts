/**
 * Example Worker: a Resend-shaped `POST /emails` endpoint over the
 * `send_email` binding, plus a Queues consumer that turns Cloudflare
 * delivery events into signed HTTP webhooks.
 */
import { CfEmail, forwardEvents, handleEmailEvents, type CreateEmailOptions } from "cfemail";

interface Env {
  EMAIL: SendEmail;
  IDEMPOTENCY: KVNamespace;
  WEBHOOK_URL: string;
  WEBHOOK_SECRET: string;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === "POST" && url.pathname === "/emails") {
      const cf = new CfEmail({ binding: env.EMAIL, idempotencyStore: env.IDEMPOTENCY });
      const payload = (await request.json()) as CreateEmailOptions;
      const idempotencyKey = request.headers.get("Idempotency-Key") ?? undefined;

      const { data, error } = await cf.emails.send(payload, { idempotencyKey });
      if (error) {
        return Response.json(
          { name: error.name, message: error.message, statusCode: error.statusCode },
          { status: error.statusCode || 500 },
        );
      }
      return Response.json(data, { status: 200 });
    }

    if (request.method === "POST" && url.pathname === "/emails/batch") {
      const cf = new CfEmail({ binding: env.EMAIL, idempotencyStore: env.IDEMPOTENCY });
      const payloads = (await request.json()) as CreateEmailOptions[];
      const { data, error } = await cf.batch.send(payloads, { concurrency: 5 });
      if (error) return Response.json(error.toJSON(), { status: error.statusCode });
      return Response.json(data);
    }

    return new Response("cfemail example", { status: 200 });
  },

  async queue(batch: MessageBatch, env: Env): Promise<void> {
    // Option A: react to events in-process.
    await handleEmailEvents(batch, {
      "email.bounced": (event) => console.log("bounced", event.data.to[0], event.data.bounce),
      "email.complained": (event) => console.log("complaint", event.data.to[0]),
    });

    // Option B: forward as signed webhooks (Resend-style payloads).
    if (env.WEBHOOK_URL && env.WEBHOOK_SECRET) {
      await forwardEvents(batch, { url: env.WEBHOOK_URL, secret: env.WEBHOOK_SECRET });
    }
  },
} satisfies ExportedHandler<Env>;
