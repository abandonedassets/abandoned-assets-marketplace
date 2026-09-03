// Resend delivery-status listener. A bounced/dropped recovery notice means the
// buyer's comms line is dead: cancel the Stripe hold, revoke the lock, tarpit
// the buyer, and return the asset to the reverse-strike tape immediately.
import { createFileRoute } from "@tanstack/react-router";
import { createHmac, timingSafeEqual } from "crypto";
import { z } from "zod";

const DEAD_TYPES = new Set(["email.bounced", "email.dropped", "email.complained"]);

const Body = z.object({
  type: z.string().max(120),
  data: z
    .object({
      email_id: z.string().max(200).optional(),
      id: z.string().max(200).optional(),
      to: z.union([z.string().max(320), z.array(z.string().max(320))]).optional(),
    })
    .passthrough()
    .optional(),
});

export const Route = createFileRoute("/api/public/hooks/resend-events")({
  server: {
    handlers: {
      GET: async () => Response.json({ ok: true, hint: "POST Resend delivery events here" }),
      POST: async ({ request }) => {
        const raw = await request.text();

        const secret = process.env["RESEND_WEBHOOK_SECRET"];
        if (secret) {
          const sig = request.headers.get("svix-signature") ?? request.headers.get("x-resend-signature") ?? "";
          const ts = request.headers.get("svix-timestamp") ?? "";
          const id = request.headers.get("svix-id") ?? "";
          const key = secret.startsWith("whsec_")
            ? Buffer.from(secret.slice(6), "base64")
            : Buffer.from(secret);
          const expected = createHmac("sha256", key).update(`${id}.${ts}.${raw}`).digest("base64");
          const provided = sig.split(" ").map((p) => p.split(",").pop() ?? "");
          const match = provided.some((p) => {
            const a = Buffer.from(p);
            const b = Buffer.from(expected);
            return a.length === b.length && timingSafeEqual(a, b);
          });
          if (!match) return new Response("Invalid signature", { status: 400 });
        }

        const parsed = Body.safeParse(JSON.parse(raw || "{}"));
        if (!parsed.success) return Response.json({ ok: false, error: "invalid_payload" }, { status: 400 });

        const { type, data } = parsed.data;
        if (!DEAD_TYPES.has(type)) return Response.json({ ok: true, skipped: type });

        const to = Array.isArray(data?.to) ? data?.to[0] ?? null : (data?.to as string | undefined) ?? null;
        const emailId = data?.email_id ?? data?.id ?? null;

        const { killSwitchOnDeadRecovery } = await import("@/lib/assignment-fee.server");
        const res = await killSwitchOnDeadRecovery({ emailId, to, reason: type });

        return Response.json({ ok: true, type, released: res.released });
      },
    },
  },
});
