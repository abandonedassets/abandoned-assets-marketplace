// Automated buyer ACH mandate reminders.
// Targets signed e-sign requests whose deal has not cleared, and nudges the
// buyer to complete the live Bluevine ACH mandate. Fail-forward: one bad row
// never stops the sweep.

const CADENCE_HOURS = 48;
const MAX_REMINDERS = 3;

function baseUrl(): string {
  return (
    process.env.PUBLIC_BASE_URL ||
    "https://project--dd9b0412-ab83-4f6e-86a4-cd1dedd921cc.lovable.app"
  );
}

const usd = (n: unknown) =>
  `$${Math.round(Number(n) || 0).toLocaleString("en-US")}`;

export async function sweepAchReminders(limit = 50) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { sendM2MEmail, assetHeaders, jsonBlock } = await import("./email.server");

  const cutoff = new Date(Date.now() - CADENCE_HOURS * 3_600_000).toISOString();

  const { data, error } = await supabaseAdmin
    .from("esign_requests")
    .select(
      "id, buyer_email, buyer_entity, assignment_fee, signed_at, pipeline_item_id, ach_reminder_count, last_ach_reminder_at, closing_pipeline_items!inner(id, address, zip, cleared_at, status, optimized_acquisition_premium)",
    )
    .not("signed_at", "is", null)
    .lt("ach_reminder_count", MAX_REMINDERS)
    .or(`last_ach_reminder_at.is.null,last_ach_reminder_at.lte.${cutoff}`)
    .limit(limit);

  if (error) return { sent: 0, skipped: 0, error: error.message };

  let sent = 0;
  let skipped = 0;

  for (const raw of (data ?? []) as unknown as Array<Record<string, any>>) {
    try {
      const deal = raw.closing_pipeline_items;
      if (!deal || deal.cleared_at) {
        skipped++;
        continue;
      }
      const email = String(raw.buyer_email ?? "").trim();
      if (!email) {
        skipped++;
        continue;
      }

      const fee = raw.assignment_fee ?? deal.optimized_acquisition_premium ?? 0;
      const rawPayUrl = `${baseUrl()}/api/public/invoice/${deal.id}?email=${encodeURIComponent(email)}`;
      const { generateTrackedEsignLink } = await import("./links");
      const payUrl = generateTrackedEsignLink(email, String(deal.id), rawPayUrl, baseUrl());
      const n = (raw.ach_reminder_count ?? 0) + 1;

      const html = `
        <div style="font:14px/1.6 -apple-system,Segoe UI,sans-serif;color:#0b0f14">
          <p>Reminder ${n} of ${MAX_REMINDERS} — your assignment on
          <strong>${deal.address ?? deal.id}</strong>${deal.zip ? ` (${deal.zip})` : ""}
          is signed but the ACH mandate has not been authorized.</p>
          <p>Assignment fee due: <strong>${usd(fee)}</strong></p>
          <p><a href="${payUrl}" style="background:#0b0f14;color:#7ee787;padding:10px 16px;border-radius:6px;text-decoration:none">Authorize ACH mandate →</a></p>
          <p style="color:#667">Bank debit (ACH) only. Cards are not accepted. The
          assignment remains unfunded until the mandate clears.</p>
          ${jsonBlock({
            asset_id: deal.id,
            assignment_fee: Number(fee) || 0,
            action: "AUTHORIZE_ACH_MANDATE",
            pay_url: payUrl,
            reminder: n,
          })}
        </div>`;

      const res = await sendM2MEmail({
        to: email,
        subject: `ACTION REQUIRED — ACH mandate pending · ${deal.address ?? deal.id}`,
        html,
        headers: assetHeaders({
          assetId: String(deal.id),
          dealType: "ASSIGNMENT",
          assignmentFee: Number(fee) || 0,
          action: "AUTHORIZE_ACH_MANDATE",
          vdrUrl: payUrl,
        }),
      });

      if (!res.ok) {
        skipped++;
        continue;
      }

      await supabaseAdmin
        .from("esign_requests")
        .update({
          ach_reminder_count: n,
          last_ach_reminder_at: new Date().toISOString(),
        } as never)
        .eq("id", raw.id);

      sent++;
    } catch (e) {
      console.error("[ach-reminder] row failed", e);
      skipped++;
    }
  }

  return { sent, skipped };
}
