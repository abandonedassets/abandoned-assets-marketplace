// Full End-to-End Pipeline Stress Probe: raw ingest -> settlement payout.
// POST /api/public/hooks/e2e-probe  { cleanup?: boolean }
// Read-mostly: creates one probe asset, traces all 5 loops, then removes it.
import { createFileRoute } from "@tanstack/react-router";
import { createHash } from "crypto";

const h = (v: unknown) => createHash("sha256").update(JSON.stringify(v ?? null)).digest("hex");

export const Route = createFileRoute("/api/public/hooks/e2e-probe")({
  server: {
    handlers: {
      GET: async () => Response.json({ ok: true, hint: "POST to run the 5-step E2E probe" }),
      POST: async ({ request }) => {
        const body: any = await request.json().catch(() => ({}));
        const cleanup = body?.cleanup !== false;
        const steps: any[] = [];
        const t = () => Date.now();
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        let dealId: string | null = null;

        // STEP 1 — RAW INGEST
        let s = t();
        try {
          const { calculateLeadConfidence } = await import("@/lib/confidence");
          const asset = {
            address: "1040 S Kilmer St",
            city: "Dayton",
            state: "OH",
            zip: "45417",
            county: "Montgomery",
            apn: "45417-E2E-TEST",
            asset_type: "SFR",
            assessed_value: 450000,
            annual_property_tax: 5200,
            lien_total: 22000,
            base_contract_price: 270000,
            optimized_acquisition_premium: 12000,
            sqft: 1450,
            beds: 3,
            baths: 2,
            title_status: "Insured",
            env_status: "clear",
            owner_entity: "Kilmer Holdings LLC",
          };
          const score = calculateLeadConfidence(asset as any);
          const { data, error } = await supabaseAdmin
            .from("closing_pipeline_items")
            .insert({
              ...asset,
              status: "Scout",
              confidence_score: score.score,
              external_id: "E2E-PROBE",
            } as never)
            .select("id,status,confidence_score")
            .maybeSingle();
          if (error || !data) throw new Error(error?.message ?? "insert_failed");
          dealId = (data as any).id;
          steps.push({
            step: 1,
            name: "RAW INGEST -> SCOUT",
            status: "SUCCESS",
            latency_ms: t() - s,
            detail: { deal_id: dealId, confidence: (data as any).confidence_score, reasons: score.penalty_reasons ?? [] },
            hash: h(data),
          });
        } catch (e: any) {
          steps.push({ step: 1, name: "RAW INGEST -> SCOUT", status: "FAIL", latency_ms: t() - s, detail: e?.message });
        }

        // STEP 2 — TRUST & RISK UNDERWRITING
        s = t();
        let trust: any = null;
        if (dealId) {
          try {
            const { data: row } = await supabaseAdmin
              .from("closing_pipeline_items").select("*").eq("id", dealId).maybeSingle();
            const { buildTrustMetrics } = await import("@/lib/trust-metrics.server");
            const { estimateValuation, INSTITUTIONAL_TAG } = await import("@/lib/institutional.server");
            trust = buildTrustMetrics(row as any);
            const val = estimateValuation(row as any);
            if (val.institutional_ready) {
              await supabaseAdmin.from("closing_pipeline_items")
                .update({ enrichment_tags: [INSTITUTIONAL_TAG] } as never).eq("id", dealId);
            }
            const pass = val.arv_discount_ratio <= 0.7 && trust?.auto_lock_eligible === true;
            steps.push({
              step: 2, name: "TRUST & RISK UNDERWRITING",
              status: pass ? "SUCCESS" : "FAIL", latency_ms: t() - s,
              detail: {
                arv_discount_ratio: val.arv_discount_ratio,
                institutional_ready: val.institutional_ready,
                fema_zone_clear: trust?.fema_zone_clear,
                hoa_rental_allowed: trust?.hoa_rental_allowed,
                title_purity_score: trust?.title_purity_score,
                exclusivity_hash: trust?.exclusivity_hash,
                auto_lock_eligible: trust?.auto_lock_eligible,
                projected_post_sale_tax: trust?.projected_post_sale_tax,
              },
              hash: h(trust),
            });
          } catch (e: any) {
            steps.push({ step: 2, name: "TRUST & RISK UNDERWRITING", status: "FAIL", latency_ms: t() - s, detail: e?.message });
          }
        }

        // STEP 3 — PORTFOLIO & DISPATCH
        s = t();
        if (dealId) {
          try {
            await supabaseAdmin.from("closing_pipeline_items")
              .update({ status: "Webhook_Dispatched" } as never).eq("id", dealId);
            const { data: after } = await supabaseAdmin
              .from("closing_pipeline_items").select("status,bundle_id,enrichment_tags").eq("id", dealId).maybeSingle();
            const origin = new URL(request.url).origin;
            const bundle = await fetch(`${origin}/api/public/hooks/portfolio-bundle`, {
              method: "POST", headers: { "Content-Type": "application/json" }, body: "{}",
            }).then((r) => r.json()).catch((e) => ({ error: String(e) }));
            const { logOutbound } = await import("@/lib/syndication.server").catch(() => ({} as any));
            if (typeof logOutbound === "function") {
              await logOutbound({ dealId, channel: "probe", target: "e2e", status: "sent", payload: { probe: true } });
            } else {
              await supabaseAdmin.from("outbound_alert_log" as never).insert({
                pipeline_item_id: dealId, channel: "probe", target: "e2e", status: "sent",
                payload: { probe: true } as never,
              } as never);
            }
            const { count } = await supabaseAdmin
              .from("outbound_alert_log" as never)
              .select("id", { count: "exact", head: true })
              .eq("pipeline_item_id", dealId);
            const ok = (after as any)?.status === "Webhook_Dispatched" && (count ?? 0) > 0;
            steps.push({
              step: 3, name: "PORTFOLIO & DISPATCH",
              status: ok ? "SUCCESS" : "FAIL", latency_ms: t() - s,
              detail: { status: (after as any)?.status, outbound_rows: count ?? 0, bundle },
              hash: h({ after, bundle }),
            });
          } catch (e: any) {
            steps.push({ step: 3, name: "PORTFOLIO & DISPATCH", status: "FAIL", latency_ms: t() - s, detail: e?.message });
          }
        }

        // STEP 4 — M2M PROGRAMMATIC LOCK & EMD
        s = t();
        if (dealId) {
          try {
            const { programmaticLock } = await import("@/lib/programmatic-lock.server");
            const res = await programmaticLock({
              bearer: "pk_e2e_probe_key",
              probe: true,
              dealId,
              paymentMethodId: String(body?.payment_method_id ?? "pm_probe"),
              buyerReference: "E2E_PROBE",
            });
            steps.push({
              step: 4, name: "M2M LOCK + $1,000 EMD + TITLE",
              status: (res as any).ok ? "SUCCESS" : "FAIL", latency_ms: t() - s,
              detail: res, hash: h(res),
            });
          } catch (e: any) {
            steps.push({ step: 4, name: "M2M LOCK + $1,000 EMD + TITLE", status: "FAIL", latency_ms: t() - s, detail: e?.message });
          }
        }

        // STEP 5 — TITLE CLOSE & BANK PAYOUT
        s = t();
        if (dealId) {
          try {
            const { payoutAssignmentFee } = await import("@/lib/payout.server");
            const payout = await payoutAssignmentFee(dealId, { probe: true });
            steps.push({
              step: 5, name: "TITLE CLOSE -> STRIPE CONNECT BANK SWEEP",
              status: (payout as any).ok ? "SUCCESS" : "FAIL", latency_ms: t() - s,
              detail: payout, hash: h(payout),
            });
          } catch (e: any) {
            steps.push({ step: 5, name: "TITLE CLOSE -> STRIPE CONNECT BANK SWEEP", status: "FAIL", latency_ms: t() - s, detail: e?.message });
          }
        }

        if (cleanup && dealId) {
          await supabaseAdmin.from("outbound_alert_log" as never).delete().eq("pipeline_item_id", dealId);
          await supabaseAdmin.from("esign_requests").delete().eq("pipeline_item_id", dealId);
          await supabaseAdmin.from("closing_pipeline_items").delete().eq("id", dealId);
        }

        return Response.json({
          probe: "E2E_PIPELINE_STRESS",
          deal_id: dealId,
          cleaned_up: cleanup,
          total_latency_ms: steps.reduce((a, x) => a + (x.latency_ms ?? 0), 0),
          steps,
        });
      },
    },
  },
});
