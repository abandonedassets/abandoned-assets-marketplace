// Bluevine settlement notification → flip deal to Funds-Cleared,
// log a title_packages dispatch row addressed to the configured title desk,
// and fire a silent admin telemetry ping. Fail-forward: any sub-step error
// is logged but never blocks acknowledgement to the bank (no retry storms).

import { createFileRoute } from "@tanstack/react-router";
import { createHmac, createHash, timingSafeEqual } from "crypto";

const TITLE_DESK_EMAIL =
  process.env.TITLE_DESK_EMAIL || "Info.abandonedassets@gmail.com";
const ESCROW_SENDER_EMAIL =
  process.env.ESCROW_SENDER_EMAIL ||
  "Assignments <onboarding@resend.dev>";

async function buildAssignmentPdf(input: {
  dealId: string;
  zip: string | null;
  address: string | null;
  basePrice: number;
  assignmentFee: number;
  bankEventId: string | null;
  bankObjectId: string | null;
  buyerEmail: string | null;
  buyerIp: string | null;
  acceptedAt: string;
  payloadHash: string;
}): Promise<Uint8Array> {
  const { PDFDocument, StandardFonts, rgb } = await import("pdf-lib");
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([612, 792]);
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const draw = (
    text: string,
    x: number,
    y: number,
    opts: { f?: any; size?: number } = {},
  ) =>
    page.drawText(text, {
      x,
      y,
      size: opts.size ?? 10,
      font: opts.f ?? font,
      color: rgb(0, 0, 0),
    });

  draw("ASSIGNMENT OF REAL ESTATE PURCHASE CONTRACT", 50, 750, {
    f: bold,
    size: 14,
  });
  draw(`Deal ID: ${input.dealId}`, 50, 720);
  draw(`Property ZIP: ${input.zip ?? "—"}`, 50, 705);
  if (input.address) draw(`Address: ${input.address}`, 50, 690);
  draw(`Base Contract Price: $${input.basePrice.toFixed(2)}`, 50, 670);
  draw(`Assignment Fee: $${input.assignmentFee.toFixed(2)}`, 50, 655);
  draw(
    `Total Acquisition Cost: $${(input.basePrice + input.assignmentFee).toFixed(2)}`,
    50,
    640,
    { f: bold },
  );

  const body =
    "Assignor hereby assigns all right, title, and interest in the underlying " +
    "Purchase and Sale Agreement (PSA) referenced by the Deal ID above to " +
    "Assignee, in consideration of the Assignment Fee paid via Bluevine ACH/wire and " +
    "evidenced by the Cryptographic Execution Block below. Assignee accepts " +
    "this assignment electronically by completing payment, which constitutes " +
    "manifest assent under the E-SIGN Act (15 U.S.C. §7001) and UETA.";
  const wrap = (s: string, max: number) => {
    const words = s.split(" ");
    const lines: string[] = [];
    let cur = "";
    for (const w of words) {
      if ((cur + " " + w).trim().length > max) {
        lines.push(cur.trim());
        cur = w;
      } else cur += " " + w;
    }
    if (cur.trim()) lines.push(cur.trim());
    return lines;
  };
  let y = 605;
  for (const line of wrap(body, 90)) {
    draw(line, 50, y);
    y -= 14;
  }

  y -= 20;
  draw("CRYPTOGRAPHIC EXECUTION BLOCK", 50, y, { f: bold, size: 11 });
  y -= 18;
  draw(`Bank Event ID:      ${input.bankEventId ?? "—"}`, 50, y); y -= 13;
  draw(`Settlement Ref:     ${input.bankObjectId ?? "—"}`, 50, y); y -= 13;
  draw(`Buyer Email:        ${input.buyerEmail ?? "—"}`, 50, y); y -= 13;
  draw(`Buyer IP:           ${input.buyerIp ?? "—"}`, 50, y); y -= 13;
  draw(`Accepted At (UTC):  ${input.acceptedAt}`, 50, y); y -= 13;
  draw(`Payload SHA-256:    ${input.payloadHash}`, 50, y); y -= 13;

  y -= 16;
  draw(
    "This document is electronically executed. Acceptance occurred upon Bluevine settlement confirmation.",
    50,
    y,
    { size: 8 },
  );

  return await pdf.save();
}

async function sendViaResend(args: {
  to: string;
  from: string;
  subject: string;
  html: string;
  pdfBytes: Uint8Array;
  pdfFilename: string;
}): Promise<{ ok: boolean; status: number; body: string }> {
  const lovableKey = process.env.LOVABLE_API_KEY;
  const resendKey = process.env.RESEND_API_KEY;
  if (!lovableKey || !resendKey) {
    return { ok: false, status: 0, body: "missing_resend_keys" };
  }
  const b64 = Buffer.from(args.pdfBytes).toString("base64");
  const res = await fetch(
    "https://connector-gateway.lovable.dev/resend/emails",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${lovableKey}`,
        "X-Connection-Api-Key": resendKey,
      },
      body: JSON.stringify({
        from: args.from,
        to: [args.to],
        subject: args.subject,
        html: args.html,
        attachments: [{ filename: args.pdfFilename, content: b64 }],
      }),
    },
  );
  const text = await res.text();
  return { ok: res.ok, status: res.status, body: text };
}

// Bluevine signs payloads as: t=<ts>,v1=<sig> — we verify v1 over
// `${t}.${rawBody}` with HMAC-SHA256 using the webhook secret.
function verifyBankSignature(
  header: string | null,
  rawBody: string,
  secret: string,
  toleranceSec = 300,
): boolean {
  if (!header || !secret) return false;
  try {
    const parts = Object.fromEntries(
      header.split(",").map((kv) => {
        const [k, ...rest] = kv.split("=");
        return [k.trim(), rest.join("=").trim()];
      }),
    );
    const t = parts["t"];
    const v1 = parts["v1"];
    if (!t || !v1) return false;
    const ageSec = Math.abs(Date.now() / 1000 - Number(t));
    if (!isFinite(ageSec) || ageSec > toleranceSec) return false;
    const expected = createHmac("sha256", secret)
      .update(`${t}.${rawBody}`)
      .digest("hex");
    const a = Buffer.from(v1);
    const b = Buffer.from(expected);
    return a.length === b.length && timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

export const Route = createFileRoute("/api/public/hooks/bluevine-settlement")({
  server: {
    handlers: {
      GET: async () =>
        Response.json({ ok: true, hint: "POST Bluevine settlement events here" }),
      POST: async ({ request }) => {
        const secret =
          process.env.BLUEVINE_WEBHOOK_SECRET ?? process.env.SETTLEMENT_WEBHOOK_SECRET ?? "";
        if (!secret) {
          console.error("[bluevine-settlement] BLUEVINE_WEBHOOK_SECRET missing — rejecting");
          return new Response("Webhook secret not configured", { status: 503 });
        }
        const rawBody = await request.text();
        const sig =
          request.headers.get("x-bluevine-signature") ??
          request.headers.get("x-settlement-signature");
        if (!verifyBankSignature(sig, rawBody, secret)) {
          return new Response("Invalid signature", { status: 401 });
        }

        let event: any;
        try {
          event = JSON.parse(rawBody);
        } catch {
          return new Response("Bad JSON", { status: 400 });
        }

        // Only act on terminal settlement events. Acknowledge everything
        // else so the bank doesn't retry.
        const terminal = new Set([
          "ach.debit.settled",
          "wire.credit.received",
          "transfer.settled",
          "payment.settled",
          "deposit.settled",
        ]);
        if (!terminal.has(event?.type)) {
          return Response.json({ received: true, ignored: event?.type });
        }

        const obj = event?.data?.object ?? {};
        const dealId: string | undefined =
          obj?.metadata?.deal_id ||
          obj?.metadata?.pipeline_item_id ||
          obj?.client_reference_id;
        const clearedAmount: number =
          typeof obj?.amount_usd === "number"
            ? obj.amount_usd
            : typeof obj?.amount === "number"
              ? obj.amount
              : 0;


        const { supabaseAdmin } = await import(
          "@/integrations/supabase/client.server"
        );

        // Atomic deduplication: claim this stripe_event_id. Duplicate
        // delivery → ACK 200 immediately, no downstream side effects.
        const eventId: string | undefined = event?.id;
        if (eventId) {
          const { error: dedupeErr } = await supabaseAdmin
            .from("processed_ledger_events" as any)
            .insert({ stripe_event_id: eventId } as any);
          if (dedupeErr) {
            if ((dedupeErr as any)?.code === "23505") {
              return Response.json({
                received: true,
                deduped: true,
                event_id: eventId,
              });
            }
            console.error("[bluevine-settlement] dedupe insert failed", dedupeErr);
          }
        }

        // EMD micro-hold settlement → unlock Sign 3 for this contract.
        const emdToken: string | undefined = obj?.metadata?.emd_token;
        if (emdToken) {
          const { markEmdAuthorized } = await import("@/lib/emd.server");
          await markEmdAuthorized(emdToken, obj?.id ?? null);
          try {
            const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
            const { data: req } = await supabaseAdmin
              .from("esign_requests")
              .select("pipeline_item_id")
              .eq("token", emdToken)
              .maybeSingle();
            const pid = (req as any)?.pipeline_item_id;
            if (pid) {
              const { setContractState } = await import("@/lib/contract-state.server");
              await setContractState(pid, "EMD_CLEARED");
              await supabaseAdmin
                .from("closing_pipeline_items")
                .update({ escrow_status: "EMD_CLEARED" } as never)
                .eq("id", pid);
            }
          } catch (e) {
            console.error("[bluevine-settlement] emd state sync failed", e);
          }
          return Response.json({ received: true, emd: "authorized" });
        }

        if (!dealId) {
          return Response.json(
            { received: true, warn: "no_deal_id_in_metadata" },
            { status: 200 },
          );
        }

        // Idempotency guard: refuse to double-clear an already-cleared deal.
        const { data: idem, error: idemErr } = await supabaseAdmin
          .rpc("clear_funds_idempotent", {
            _deal_id: dealId,
            _cleared_amount: clearedAmount,
            _stripe_event_id: eventId ?? null,
          } as any);
        if (idemErr) {
          console.error("[bluevine-settlement] idempotent clear failed", idemErr);
          return Response.json(
            { received: true, error: idemErr.message },
            { status: 200 },
          );
        }
        const idemRow = Array.isArray(idem) ? idem[0] : idem;
        if (idemRow?.was_already_cleared) {
          return Response.json({
            received: true,
            deduped: true,
            reason: "already_cleared",
            deal_id: dealId,
          });
        }
        const cleared_at = (idemRow?.cleared_at as string) ?? new Date().toISOString();

        // The bank settlement is provider truth for the property leg. Capture
        // the separately-authorized assignment fee before any payout attempt.
        let feeCapture: unknown = { ok: false, error: "not_authorized" };
        try {
          const { captureAssignmentFee } = await import("@/lib/assignment-fee.server");
          feeCapture = await captureAssignmentFee(dealId);
          if (!(feeCapture as { ok?: boolean }).ok) {
            await supabaseAdmin.from("dead_letter_queue" as any).insert({
              source: "bluevine-settlement:assignment-fee-capture",
              payload: { deal_id: dealId, capture: feeCapture } as any,
            } as any);
          }
        } catch (e) {
          console.error("[bluevine-settlement] fee capture failed", e);
        }

        const { data: deal, error } = await supabaseAdmin
          .from("closing_pipeline_items")
          .select(
            "id, zip, address, base_contract_price, optimized_acquisition_premium, locked_at, locked_by_key_id",
          )
          .eq("id", dealId)
          .maybeSingle();

        if (error) {
          console.error("[bluevine-settlement] post-clear fetch failed", error);
          return Response.json(
            { received: true, error: error.message },
            { status: 200 },
          );
        }
        if (!deal) {
          return Response.json(
            { received: true, warn: "deal_not_found", deal_id: dealId },
            { status: 200 },
          );
        }

        const d = deal as any;

        // Feed settlement latency back to the dispatching endpoint.
        if (d.locked_at) {
          try {
            await supabaseAdmin.rpc("record_endpoint_fill", {
              _deal_id: dealId,
              _latency_ms: Math.max(
                0,
                new Date(cleared_at).getTime() -
                  new Date(d.locked_at).getTime(),
              ),
            });
          } catch (e) {
            console.error("[bluevine-settlement] record_endpoint_fill failed", e);
          }
        }

        // Auto-Escrow Dispatch
        const assignmentFee = Number(d.optimized_acquisition_premium ?? 0);
        const basePrice = Number(d.base_contract_price ?? 0);


        // Clickwrap PDF generation + storage + Resend dispatch to title desk.
        // Fail-forward: any sub-step logs to DLQ but never blocks ACK.
        const buyerEmail: string | null =
          obj?.customer_details?.email || obj?.customer_email || null;
        const buyerIp: string | null =
          obj?.customer_details?.address?.country
            ? request.headers.get("cf-connecting-ip") ||
              request.headers.get("x-forwarded-for") ||
              null
            : request.headers.get("cf-connecting-ip") ||
              request.headers.get("x-forwarded-for") ||
              null;
        const payloadHash = createHash("sha256")
          .update(
            JSON.stringify({
              deal_id: dealId,
              stripe_event_id: event?.id ?? null,
              settlement_ref: obj?.id ?? null,
              amount: clearedAmount,
              cleared_at,
            }),
          )
          .digest("hex");

        let escrowDocPath: string | null = null;
        let pdfBytes: Uint8Array | null = null;
        try {
          pdfBytes = await buildAssignmentPdf({
            dealId,
            zip: d.zip ?? null,
            address: d.address ?? null,
            basePrice,
            assignmentFee,
            bankEventId: event?.id ?? null,
            bankObjectId: obj?.id ?? null,
            buyerEmail,
            buyerIp,
            acceptedAt: cleared_at,
            payloadHash,
          });
          const objectPath = `assignments/${dealId}/${Date.now()}.pdf`;
          const { error: upErr } = await supabaseAdmin.storage
            .from("escrow-docs")
            .upload(objectPath, pdfBytes, {
              contentType: "application/pdf",
              upsert: false,
            });
          if (upErr) throw upErr;
          escrowDocPath = objectPath;
          await supabaseAdmin
            .from("closing_pipeline_items")
            .update({
              escrow_doc_path: objectPath,
              escrow_status: "escrow_opened",
            } as any)
            .eq("id", dealId);
        } catch (e: any) {
          console.error("[bluevine-settlement] pdf gen/upload failed", e);
          try {
            await supabaseAdmin.from("dead_letter_queue" as any).insert({
              source: "bluevine-settlement:pdf",
              payload: { deal_id: dealId, error: String(e?.message ?? e) } as any,
            } as any);
          } catch {}
        }

        const payload = {
          generated_at: cleared_at,
          to: TITLE_DESK_EMAIL,
          subject: `Assignment of Contract — Deal ${String(dealId).slice(0, 8)} — Funds Cleared`,
          deal_id: dealId,
          zip: d.zip ?? null,
          address: d.address ?? null,
          base_contract_price: basePrice,
          assignment_fee: assignmentFee,
          total_acquisition_cost: basePrice + assignmentFee,
          stripe_event_id: event?.id ?? null,
          settlement_ref: obj?.id ?? null,
          buyer_email: buyerEmail,
          buyer_ip: buyerIp,
          payload_sha256: payloadHash,
          escrow_doc_path: escrowDocPath,
          buyer_key_tag: d.locked_by_key_id
            ? String(d.locked_by_key_id).slice(0, 8)
            : null,
        };

        try {
          await supabaseAdmin
            .from("title_packages")
            .upsert(
              {
                pipeline_item_id: dealId,
                package_status: "Generated" as any,
                title_company_ref: TITLE_DESK_EMAIL,
                payload: payload as any,
              } as any,
              { onConflict: "pipeline_item_id" },
            );
        } catch (e) {
          console.error("[bluevine-settlement] title_packages upsert failed", e);
        }

        // Resend dispatch to title desk with the executed PDF attached.
        if (pdfBytes) {
          try {
            const html = `
              <h2>Assignment of Contract — Funds Cleared</h2>
              <p><strong>Deal:</strong> ${dealId}<br/>
              <strong>Address:</strong> ${d.address ?? "—"} (${d.zip ?? "—"})<br/>
              <strong>Total Acquisition Cost:</strong> $${(basePrice + assignmentFee).toFixed(2)}<br/>
              <strong>Assignment Fee:</strong> $${assignmentFee.toFixed(2)}<br/>
              <strong>Settlement Event:</strong> ${event?.id ?? "—"}<br/>
              <strong>Payload SHA-256:</strong> ${payloadHash}</p>
              <p>Executed Assignment of Contract attached. Funds have cleared into the Bluevine business account. Please open escrow.</p>
            `;
            const sent = await sendViaResend({
              to: TITLE_DESK_EMAIL,
              from: ESCROW_SENDER_EMAIL,
              subject: payload.subject,
              html,
              pdfBytes,
              pdfFilename: `assignment-${String(dealId).slice(0, 8)}.pdf`,
            });
            if (!sent.ok) {
              console.error("[bluevine-settlement] resend failed", sent.status, sent.body);
              await supabaseAdmin.from("dead_letter_queue" as any).insert({
                source: "bluevine-settlement:resend",
                payload: {
                  deal_id: dealId,
                  status: sent.status,
                  body: sent.body.slice(0, 1000),
                } as any,
              } as any);
            }
          } catch (e: any) {
            console.error("[bluevine-settlement] resend dispatch failed", e);
            try {
              await supabaseAdmin.from("dead_letter_queue" as any).insert({
                source: "bluevine-settlement:resend",
                payload: { deal_id: dealId, error: String(e?.message ?? e) } as any,
              } as any);
            } catch {}
          }
        }

        // Silent telemetry — never blocks the splashdown ACK.
        try {
          const { notifyAdmin, fmtUsd } = await import("@/lib/notify.server");
          await notifyAdmin(
            `💸 STRIPE CLEARED → Title dispatched to ${TITLE_DESK_EMAIL}. ` +
              `${fmtUsd(clearedAmount)} on deal ${String(dealId).slice(0, 8)} (ZIP ${d.zip ?? "—"}).`,
          );
        } catch (e) {
          console.error("[bluevine-settlement] notify failed", e);
        }

        // Revenue Loop: optional immediate Connect payout at clearance. When
        // AUTO_PAYOUT_ON_CLEAR is off, payout fires on title-closing webhook.
        let payout: unknown = { ok: false, reason: "deferred_to_title_close" };
        if (process.env.AUTO_PAYOUT_ON_CLEAR === "true") {
          try {
            const { payoutAssignmentFee } = await import("@/lib/payout.server");
            payout = await payoutAssignmentFee(dealId);
          } catch (e) {
            console.error("[bluevine-settlement] payout failed", e);
          }
        }

        return Response.json({
          received: true,
          deal_id: dealId,
          status: "Funds-Cleared",
          fee_capture: feeCapture,
          title_desk: TITLE_DESK_EMAIL,
          payout,
        });
      },
    },
  },
});
