import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

const Schema = z.object({
  fund_name: z.string().trim().min(2).max(200),
  contact_email: z.string().trim().email().max(255).optional(),
  target_zips: z
    .array(z.string().trim().regex(/^[0-9]{3,5}$/))
    .max(50)
    .optional()
    .default([]),
  aum_bracket: z
    .enum([
      "<$50M",
      "$50M-$250M",
      "$250M-$1B",
      "$1B-$5B",
      "$5B+",
    ])
    .optional(),
  message: z.string().trim().max(2000).optional(),
});

// Reverse-inquiry onboarding — funds submit themselves to the waitlist.
export const Route = createFileRoute("/api/public/request-key")({
  server: {
    handlers: {
      OPTIONS: async () =>
        new Response(null, { status: 204, headers: CORS }),
      POST: async ({ request }) => {
        let body: unknown;
        try {
          body = await request.json();
        } catch {
          return Response.json(
            { error: "invalid_json" },
            { status: 400, headers: CORS },
          );
        }
        const parsed = Schema.safeParse(body);
        if (!parsed.success) {
          return Response.json(
            { error: "invalid_payload", issues: parsed.error.issues },
            { status: 400, headers: CORS },
          );
        }

        const ip =
          request.headers.get("cf-connecting-ip") ??
          request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
          null;

        const { supabaseAdmin } = await import(
          "@/integrations/supabase/client.server"
        );
        const { data, error } = await supabaseAdmin
          .from("buyer_waitlist")
          .insert({
            fund_name: parsed.data.fund_name,
            contact_email: parsed.data.contact_email ?? null,
            target_zips: parsed.data.target_zips ?? [],
            aum_bracket: parsed.data.aum_bracket ?? null,
            message: parsed.data.message ?? null,
            source_ip: ip,
          })
          .select("id, created_at")
          .single();

        if (error) {
          console.error("buyer_waitlist insert failed", error);
          return Response.json(
            { error: "queue_unavailable" },
            { status: 503, headers: CORS },
          );
        }

        return Response.json(
          {
            status: "queued",
            position_disclosure:
              "Your fund has been added to the institutional allocation waitlist. The desk reviews requests in the order received. Allocation is not guaranteed.",
            request_id: data.id,
            queued_at: data.created_at,
          },
          { status: 202, headers: CORS },
        );
      },
    },
  },
});
