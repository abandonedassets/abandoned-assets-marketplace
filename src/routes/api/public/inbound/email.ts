// Inbound email parse webhook (Resend / SendGrid Inbound Parse).
// Cryptographically verified → replay-guarded → intent-classified → audited.

import { createFileRoute } from "@tanstack/react-router";

function pick(o: any, keys: string[]): string {
  for (const k of keys) {
    const v = k.split(".").reduce((a: any, p) => (a == null ? a : a[p]), o);
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return "";
}

function extractEmail(s: string): string {
  const m = s.match(/[\w.+-]+@[\w-]+\.[\w.-]+/);
  return m ? m[0].toLowerCase() : "";
}

// Explicit, unambiguous commitment language only. Questions never auto-execute.
const HARD_INTENT =
  /\b(i'?ll take it|we'?ll take it|send (me )?the contract|send (over )?(the )?(assignment )?(agreement|contract)|proceed with (the )?(purchase|assignment)|execute the (contract|agreement))\b/i;
const QUESTION = /\?|\bnegotiab|\bwhat (is|are)\b|\bcan you\b|\bhow much\b|\bis (the|this)\b/i;

export const Route = createFileRoute("/api/public/inbound/email")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const rawBody = await request.text();
        const {
          verifyInboundSignature,
          claimWebhookEvent,
          writeAuditLog,
          clientIp,
        } = await import("@/lib/webhook-verify.server");

        const ip = clientIp(request);
        const secret =
          process.env.INBOUND_EMAIL_WEBHOOK_SECRET ??
          process.env.RESEND_WEBHOOK_SECRET ??
          "";

        const verdict = verifyInboundSignature({
          headers: request.headers,
          rawBody,
          secret,
        });
        if (!verdict.ok) {
          await writeAuditLog({
            event_type: "INBOUND_EMAIL_REJECTED",
            reason: `signature_rejected:${verdict.reason}`,
            ip_address: ip,
            raw_payload: { reason: verdict.reason, body_preview: rawBody.slice(0, 500) },
          });
          return new Response("Invalid signature", { status: 401 });
        }

        if (await claimWebhookEvent(verdict.eventId, "inbound_email")) {
          return Response.json({ ok: true, replayed: true });
        }

        let payload: any = {};
        const ct = request.headers.get("content-type") ?? "";
        try {
          if (ct.includes("application/json")) payload = JSON.parse(rawBody);
          else payload = Object.fromEntries(new URLSearchParams(rawBody).entries());
        } catch {
          return Response.json({ error: "bad_payload" }, { status: 400 });
        }

        const from = extractEmail(
          pick(payload, ["from", "sender", "envelope.from", "data.from", "headers.from"]),
        );
        const subject = pick(payload, ["subject", "data.subject"]);
        const body = pick(payload, ["text", "plain", "body", "html", "data.text", "data.html"]);
        const combined = `${subject}\n${body}`.replace(/<[^>]+>/g, " ");

        // Public-records (FOIA) CSV interception — permit exports land as builder leads.
        let csvIngest: unknown = null;
        try {
          const atts: any[] = Array.isArray(payload?.attachments)
            ? payload.attachments
            : Array.isArray(payload?.data?.attachments)
              ? payload.data.attachments
              : [];
          for (const a of atts.slice(0, 5)) {
            const name = String(a?.filename ?? a?.name ?? "");
            const type = String(a?.content_type ?? a?.contentType ?? "");
            if (!/\.csv$/i.test(name) && !/csv|text\/plain/i.test(type)) continue;
            const raw = a?.content ?? a?.data ?? "";
            const text =
              typeof raw === "string" && /^[A-Za-z0-9+/=\s]+$/.test(raw) && !raw.includes(",\n")
                ? Buffer.from(raw, "base64").toString("utf8")
                : String(raw);
            const { ingestPermitCsv } = await import("@/lib/foia.server");
            csvIngest = await ingestPermitCsv(text, `foia:${from || "unknown"}`);
            break;
          }
        } catch (e) {
          csvIngest = { ok: false, error: (e as Error).message };
        }

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { classifyIntent } = await import("@/lib/email.server");
        const intent = await classifyIntent(combined);

        // TIMBER intake — runs before/independently of contract-intent logic so
        // timber payloads never stall on keyword mismatch. 100% -> Jazmin.
        let timberIntake: unknown = null;
        try {
          const { processTimberIntake } = await import("@/lib/timber-intake.server");
          const r = await processTimberIntake({
            text: combined,
            payload,
            fromEmail: from || null,
          });
          if (r.timber) timberIntake = r;
        } catch (e) {
          timberIntake = { ok: false, error: (e as Error).message };
        }


        // COMMERCIAL intake — runs independently of contract-intent logic so
        // commercial/CRE payloads never stall on keyword mismatch. 100% -> owner.
        let commercialIntake: unknown = null;
        try {
          const { processCommercialIntake } = await import("@/lib/commercial-intake.server");
          const r = await processCommercialIntake({
            text: combined,
            payload,
            fromEmail: from || null,
          });
          if (r.commercial) commercialIntake = r;
        } catch (e) {
          commercialIntake = { ok: false, error: (e as Error).message };
        }

        // Confidence scoring: deterministic phrase hit = 1.0; LLM-only = 0.6.
        const hardHit = HARD_INTENT.test(combined);
        const looksLikeQuestion = QUESTION.test(combined);
        const confidence = hardHit ? 1 : intent === "CONTRACT_REQUEST" ? 0.6 : 0.3;
        const autoExecute =
          intent === "CONTRACT_REQUEST" && hardHit && !looksLikeQuestion;

        let matchedItem: string | null = null;
        let action = "logged";

        try {
          const idMatch = combined.match(
            /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i,
          );
          if (idMatch) {
            const { data } = await supabaseAdmin
              .from("closing_pipeline_items")
              .select("id")
              .eq("id", idMatch[0])
              .maybeSingle();
            matchedItem = data?.id ?? null;
          }
          if (!matchedItem && from) {
            const { data: bb } = await supabaseAdmin
              .from("buyer_buy_boxes")
              .select("buyer_id")
              .eq("active", true)
              .limit(50);
            const buyerIds = (bb ?? []).map((b: any) => b.buyer_id);
            if (buyerIds.length) {
              const { data: deals } = await supabaseAdmin
                .from("closing_pipeline_items")
                .select("id, optimized_acquisition_premium")
                .in("matched_buyer_id", buyerIds)
                .is("cleared_at", null)
                .order("optimized_acquisition_premium", { ascending: false })
                .limit(1);
              matchedItem = deals?.[0]?.id ?? null;
            }
          }

          if (autoExecute && matchedItem && from) {
            const { createAndSendContract } = await import("@/lib/esign.server");
            const origin = new URL(request.url).origin;
            const r = await createAndSendContract({
              dealId: matchedItem,
              buyerEmail: from,
              origin,
            });
            action = r.ok ? `esign_sent:${r.token}` : `esign_failed:${r.error}`;
          } else if (intent === "CONTRACT_REQUEST" && !autoExecute) {
            action = "held_for_human_review:low_confidence";
          } else if (intent === "CONTRACT_REQUEST") {
            action = "intent_matched_no_deal";
          }
        } catch (e: any) {
          // Fail-forward: never stall the pipeline on a parse error.
          action = `error:${String(e?.message ?? e).slice(0, 180)}`;
        }

        const commercialNote =
          commercialIntake && (commercialIntake as { reason?: string }).reason
            ? `|commercial:${(commercialIntake as { reason: string }).reason}`
            : "";

        const timberNote =
          timberIntake && (timberIntake as { reason?: string }).reason
            ? `|timber:${(timberIntake as { reason: string }).reason}`
            : "";

        await supabaseAdmin.from("inbound_email_log").insert({
          from_email: from || null,
          subject: subject || null,
          body_preview: combined.slice(0, 800),
          detected_intent: timberIntake
            ? "TIMBER_INTAKE"
            : commercialIntake
              ? "COMMERCIAL_INTAKE"
              : intent,
          matched_item_id:
            matchedItem ?? (timberIntake as { pipeline_item_id?: string | null })?.pipeline_item_id ?? null,
          action_taken: `${action}${timberNote}${commercialNote}`,
          raw: payload,
        });


        await writeAuditLog({
          event_type: "INBOUND_EMAIL",
          reason: `${intent}:${action}`,
          pipeline_item_id: matchedItem,
          llm_confidence_score: confidence,
          ip_address: ip,
          raw_payload: {
            from,
            subject,
            intent,
            auto_execute: autoExecute,
            body_preview: combined.slice(0, 800),
          },
        });

        return Response.json({
          ok: true,
          intent,
          confidence,
          auto_execute: autoExecute,
          matched_item_id: matchedItem,
          action,
          csv_ingest: csvIngest,
          timber_intake: timberIntake,
          commercial_intake: commercialIntake,
        });

      },
    },
  },
});
