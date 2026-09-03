// Bankruptcy feed ingestion — PACER / Chapter 11 restructuring / Lis Pendens
// scrapers POST court filings here; matching assets are flagged DIP_CHAPTER_11.
//
// POST /api/public/hooks/dip-ingest
//   X-M2M-Signature: sha256=<hmac of raw body>
//   X-Idempotency-Key: <filing id>
//   { filings: [{ case_number, court_district, apn?, address?, zip?,
//                 sale_motion_ref?, proposed_order_ref?, sale_hearing_at?,
//                 closing_deadline_at?, stalking_horse_bid?,
//                 court_overbid_increment? }] }
import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

const Filing = z.object({
  case_number: z.string().min(3).max(120),
  court_district: z.string().max(120).optional(),
  deal_id: z.string().uuid().optional(),
  apn: z.string().max(80).optional(),
  address: z.string().max(200).optional(),
  zip: z.string().max(12).optional(),
  sale_motion_ref: z.string().max(200).optional(),
  proposed_order_ref: z.string().max(200).optional(),
  sale_hearing_at: z.string().max(40).optional(),
  closing_deadline_at: z.string().max(40).optional(),
  stalking_horse_bid: z.number().nonnegative().max(1_000_000_000).optional(),
  court_overbid_increment: z.number().nonnegative().max(100_000_000).optional(),
});

const Body = z.object({ filings: z.array(Filing).min(1).max(200) });

export const Route = createFileRoute("/api/public/hooks/dip-ingest")({
  server: {
    handlers: {
      GET: async () =>
        Response.json({
          endpoint: "/api/public/hooks/dip-ingest",
          method: "POST",
          headers: ["X-M2M-Signature", "X-Idempotency-Key"],
          body: { filings: [{ case_number: "23-11045", apn: "0000-000-000" }] },
        }),
      POST: async ({ request }) => {
        try {
          const raw = await request.text();
          const { signM2M, claimIdempotencyKey } = await import("@/lib/m2m-protocol.server");

          const expected = signM2M(raw);
          const provided = (request.headers.get("x-m2m-signature") ?? "").replace(/^sha256=/i, "");
          if (expected && provided !== expected) {
            return Response.json({ ok: false, error: "invalid_signature" }, { status: 401 });
          }

          const claim = await claimIdempotencyKey(
            request.headers.get("x-idempotency-key"),
            "dip-ingest",
          );
          if (!claim.fresh) return Response.json({ ok: true, skipped: "duplicate_idempotency_key" });

          const parsed = Body.safeParse(JSON.parse(raw || "{}"));
          if (!parsed.success)
            return Response.json({ ok: false, error: "invalid_payload" }, { status: 400 });

          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
          let flagged = 0;
          let unmatched = 0;

          for (const f of parsed.data.filings) {
            // Fail-forward: one bad filing never stalls the batch.
            try {
              let q = supabaseAdmin.from("closing_pipeline_items").select("id").limit(5);
              if (f.deal_id) q = q.eq("id", f.deal_id);
              else if (f.apn) q = q.eq("apn", f.apn);
              else if (f.address) q = q.ilike("address", `%${f.address}%`);
              else if (f.zip) q = q.eq("zip", f.zip);
              else {
                unmatched += 1;
                continue;
              }

              const { data: rows } = await q;
              const ids = ((rows ?? []) as Array<{ id: string }>).map((r) => r.id);
              if (!ids.length) {
                unmatched += 1;
                continue;
              }

              const patch: Record<string, unknown> = {
                is_dip: true,
                asset_type: "DIP_CHAPTER_11",
                contract_structure: "SECTION_363",
                dip_case_number: f.case_number,
              };
              if (f.court_district) patch["dip_court_district"] = f.court_district;
              if (f.sale_motion_ref) patch["dip_sale_motion_ref"] = f.sale_motion_ref;
              if (f.proposed_order_ref) patch["dip_proposed_order_ref"] = f.proposed_order_ref;
              if (f.sale_hearing_at) patch["dip_sale_hearing_at"] = f.sale_hearing_at;
              if (f.closing_deadline_at) patch["dip_closing_deadline_at"] = f.closing_deadline_at;
              if (f.stalking_horse_bid != null) patch["stalking_horse_bid"] = f.stalking_horse_bid;
              if (f.court_overbid_increment != null)
                patch["court_overbid_increment"] = f.court_overbid_increment;

              const { error } = await supabaseAdmin
                .from("closing_pipeline_items")
                .update(patch as never)
                .in("id", ids);
              if (error) {
                console.error("[dip-ingest] update failed", error);
                continue;
              }
              flagged += ids.length;

              await supabaseAdmin
                .from("system_audit_logs")
                .insert(
                  ids.map((id) => ({
                    pipeline_item_id: id,
                    event_type: "DIP_CHAPTER_11_FLAGGED",
                    reason: `Section 363 filing ${f.case_number}`,
                    payload: f as never,
                  })) as never,
                )
                .then(undefined, () => {});
            } catch (e) {
              console.error("[dip-ingest] filing failed", e);
            }
          }

          return Response.json({
            ok: true,
            filings: parsed.data.filings.length,
            flagged,
            unmatched,
            at: new Date().toISOString(),
          });
        } catch (e) {
          console.error("[dip-ingest] failed", e);
          return Response.json(
            { ok: false, error: e instanceof Error ? e.message : String(e) },
            { status: 200 },
          );
        }
      },
    },
  },
});
