// Gmail dispatch rail for outbound offers.
// NOTE: the runtime is a Cloudflare Worker — raw SMTP (nodemailer) cannot open
// sockets there. We keep the exact same contract/identity (from =
// GMAIL_USER / info.abandonedassets@gmail.com) and send over the HTTPS mail
// gateway instead. Behaviour, headers and telemetry are identical.

import { appBaseUrl } from "./links";

export type DispatchContract = {
  id: string;
  external_id?: string | null;
  apn?: string | null;
  address?: string | null;
  city?: string | null;
  zip?: string | null;
  base_contract_price?: number | null;
  optimized_acquisition_premium?: number | null;
  target_fee_margin?: number | null;
  gross_price?: number | null;
  seller_price?: number | null;
  title_status?: string | null;
};

export type DispatchBuyer = {
  id?: string | null;
  contact_email: string;
  label?: string | null;
};

export function gmailSender(): string {
  // Quota-blocked team inbox is no longer the default reply lane.
  return (
    process.env.OPS_REPLY_EMAIL ||
    process.env.GMAIL_USER ||
    "reeledgeentertainmentllc@gmail.com"
  ).trim();
}


const amount = (value: number | null | undefined) =>
  Number.isFinite(Number(value)) ? Math.round(Number(value)) : 0;

export function assignmentFee(contract: DispatchContract): number {
  const explicit = amount(
    contract.optimized_acquisition_premium ?? contract.target_fee_margin,
  );
  if (explicit > 0) return explicit;
  return Math.max(0, amount(contract.gross_price) - amount(contract.seller_price));
}

export function buildOfferText(
  contract: DispatchContract,
  buyer: DispatchBuyer,
  baseUrl = appBaseUrl(),
): string {
  const query = `contract_id=${encodeURIComponent(contract.id)}&buyer_id=${encodeURIComponent(buyer.id ?? "")}`;
  const clickUrl = `${baseUrl}/api/public/v1/track/click?${query}`;
  const pixelUrl = `${baseUrl}/api/public/v1/track/open?${query}`;
  const assetRef = contract.external_id ?? contract.apn ?? contract.id;
  return `TIMESTAMP: ${new Date().toISOString()}
BUY_BOX_MATCH: ${buyer.label ?? "UNNAMED_BUY_BOX"}
ASSET_REF: ${assetRef}

SETTLEMENT_DATA:
- GROSS_CONTRACT_VALUE: $${amount(contract.gross_price ?? contract.base_contract_price)}
- TARGET_ASSIGNMENT_MARGIN: $${assignmentFee(contract)}
- TITLE_STATUS: ${contract.title_status ?? "Pending"}

ACTION_REQUIRED:
AWAITING_DIGITAL_SIGNATURE: ${clickUrl}
TIME_IN_FORCE_EXPIRATION: 60_MINUTES

TRACKING_PIXEL: ${pixelUrl}

--
You received this because this asset matched your standing buy box.
Opt out of future deal alerts: ${baseUrl}/api/public/v1/track/click?${query}&optout=1`;
}

const usd = (v: number | null | undefined) => `$${amount(v).toLocaleString("en-US")}`;

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export function buildOfferHtml(
  contract: DispatchContract,
  buyer: DispatchBuyer,
  baseUrl = appBaseUrl(),
): string {
  const query = `contract_id=${encodeURIComponent(contract.id)}&buyer_id=${encodeURIComponent(buyer.id ?? "")}`;
  const clickUrl = `${baseUrl}/api/public/v1/track/click?${query}`;
  const pixelUrl = `${baseUrl}/api/public/v1/track/open?${query}`;
  const optOutUrl = `${clickUrl}&optout=1`;
  const assetRef = String(contract.external_id ?? contract.apn ?? contract.id);
  const mono = "font-family:'SFMono-Regular',Consolas,'Liberation Mono',Menlo,monospace;font-size:13px;color:#0f172a;";
  const labelCell = "padding:10px 14px;border-bottom:1px solid #e2e8f0;font-family:Arial,Helvetica,sans-serif;font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:#64748b;background:#f8fafc;width:44%;";
  const valueCell = `padding:10px 14px;border-bottom:1px solid #e2e8f0;${mono}`;

  const row = (label: string, value: string) =>
    `<tr><td style="${labelCell}">${esc(label)}</td><td style="${valueCell}">${esc(value)}</td></tr>`;

  return `<!doctype html><html><body style="margin:0;padding:0;background:#eef2f7;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#eef2f7;padding:24px 12px;">
<tr><td align="center">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff;border:1px solid #d8dee9;border-radius:6px;overflow:hidden;">
  <tr><td style="background:#0b1220;padding:22px 24px;">
    <div style="font-family:Arial,Helvetica,sans-serif;font-size:17px;font-weight:700;color:#ffffff;letter-spacing:.02em;">ReelEdge Acquisitions</div>
    <div style="font-family:Arial,Helvetica,sans-serif;font-size:11px;letter-spacing:.22em;color:#8ea3c0;margin-top:6px;">TRADE ALLOCATION NOTICE</div>
  </td></tr>
  <tr><td style="padding:24px 24px 8px 24px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e2e8f0;border-collapse:collapse;">
      ${row("Asset Ref", assetRef)}
      ${row("APN", String(contract.apn ?? "N/A"))}
      ${row("Timestamp", new Date().toISOString())}
      ${row("Buy Box Match", String(buyer.label ?? "UNNAMED_BUY_BOX"))}
    </table>
  </td></tr>
  <tr><td style="padding:16px 24px 8px 24px;">
    <div style="font-family:Arial,Helvetica,sans-serif;font-size:11px;letter-spacing:.14em;color:#334155;font-weight:700;padding-bottom:8px;">SETTLEMENT DATA</div>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e2e8f0;border-collapse:collapse;">
      ${row("Gross Contract Value", usd(contract.gross_price ?? contract.base_contract_price))}
      ${row("Target Assignment Margin", usd(assignmentFee(contract)))}
      ${row("Title Status", String(contract.title_status ?? "Pending"))}
    </table>
  </td></tr>
  <tr><td align="center" style="padding:26px 24px 6px 24px;">
    <a href="${clickUrl}" style="display:inline-block;background:#047857;color:#ffffff;font-family:Arial,Helvetica,sans-serif;font-size:14px;font-weight:700;letter-spacing:.06em;text-decoration:none;padding:15px 30px;border-radius:4px;">REVIEW &amp; EXECUTE CONTRACT</a>
  </td></tr>
  <tr><td align="center" style="padding:4px 24px 24px 24px;">
    <div style="font-family:Arial,Helvetica,sans-serif;font-size:12px;font-weight:700;color:#b91c1c;">TIME_IN_FORCE_EXPIRATION: 60_MINUTES</div>
  </td></tr>
  <tr><td style="background:#f8fafc;border-top:1px solid #e2e8f0;padding:16px 24px;">
    <div style="font-family:Arial,Helvetica,sans-serif;font-size:11px;color:#94a3b8;line-height:1.6;">
      You received this because this asset matched your standing buy box.<br/>
      <a href="${optOutUrl}" style="color:#94a3b8;text-decoration:underline;">Opt out of future deal alerts</a>
    </div>
    <img src="${pixelUrl}" width="1" height="1" alt="" style="display:block;border:0;width:1px;height:1px;opacity:0;" />
  </td></tr>
</table>
</td></tr></table>
</body></html>`;
}

/** Explicit failure enums — never leave reason_code NULL again. */
export type DispatchFailureEnum =
  | "NO_CONTACT_EMAIL"
  | "DISPATCH_GUARD_BLOCKED"
  | "WARMUP_CAP_REACHED"
  | "TITLE_CREDENTIALS_MISSING"
  | "TRANSPORT_SEND_FAILED"
  | "UNHANDLED_EXCEPTION";

/** Domain reputation warm-up ladder: day-index → max sends in a rolling 24h. */
const WARMUP_LADDER = [50, 50, 100, 200, 200, 400, 800];
const WARMUP_MAX = 2000;
/** Pinned warm-up start: Day 1 begins here (locked to 50/day). */
const WARMUP_START_MS = Date.parse("2026-08-31T00:00:00Z");

export async function warmupCapToday(): Promise<{ cap: number; sent: number; day: number }> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const startedAt = WARMUP_START_MS;
  const day = Math.max(0, Math.floor((Date.now() - startedAt) / 86_400_000));
  const cap = day < WARMUP_LADDER.length ? WARMUP_LADDER[day]! : WARMUP_MAX;

  const { count } = await supabaseAdmin
    .from("offer_delivery_logs")
    .select("id", { count: "exact", head: true })
    .eq("status", "DELIVERED")
    .gte("created_at", new Date(Date.now() - 86_400_000).toISOString());
  return { cap, sent: count ?? 0, day };
}

async function logRejection(
  contract: DispatchContract,
  buyer: DispatchBuyer,
  failure: DispatchFailureEnum,
  detail?: string,
) {
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await supabaseAdmin.from("offer_delivery_logs").insert({
      contract_id: contract.id,
      buyer_id: buyer?.id ?? null,
      recipient_email: buyer?.contact_email ?? null,
      status: "REJECTED",
      reason_code: "CUSTOM_OTHER",
      meta: {
        failure_enum: failure,
        detail: detail ?? null,
        failed_at: new Date().toISOString(),
      } as never,
    } as never);
  } catch (e) {
    console.error("[dispatch-gmail] rejection log failed", e);
  }
}

/** Send one offer to one buyer and log DELIVERED. Never throws. */
export async function dispatch_offer(
  contract: DispatchContract,
  buyer: DispatchBuyer,
): Promise<{ ok: boolean; id?: string | null; error?: string; failure?: DispatchFailureEnum }> {
  try {
    if (!buyer?.contact_email) {
      await logRejection(contract, buyer, "NO_CONTACT_EMAIL");
      return { ok: false, error: "no_contact_email", failure: "NO_CONTACT_EMAIL" };
    }

    // Guardrails: (property,buyer) dedupe + 24h buyer cooldown + 25/hr cap.
    {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const { data: slot } = await supabaseAdmin.rpc("claim_dispatch_slot" as never, {
        _property_id: contract.id,
        _buyer_id: buyer.id ?? null,
        _recipient_email: buyer.contact_email,
      } as never);
      const row = Array.isArray(slot) ? (slot[0] as { allowed?: boolean; reason?: string }) : null;
      if (!row?.allowed) {
        const reason = row?.reason ?? "dispatch_blocked";
        await logRejection(contract, buyer, "DISPATCH_GUARD_BLOCKED", reason);
        return { ok: false, error: reason, failure: "DISPATCH_GUARD_BLOCKED" };
      }
    }
    // Domain reputation warm-up ladder (50 → 200 → 800 → 2000/day).
    try {
      const w = await warmupCapToday();
      if (w.sent >= w.cap) {
        await logRejection(
          contract,
          buyer,
          "WARMUP_CAP_REACHED",
          `day_${w.day}_cap_${w.cap}_sent_${w.sent}`,
        );
        return { ok: false, error: "warmup_cap_reached", failure: "WARMUP_CAP_REACHED" };
      }
    } catch (e) {
      console.error("[dispatch-gmail] warmup check failed (fail-forward)", e);
    }

    const baseUrl = appBaseUrl();
    const text = buildOfferText(contract, buyer, baseUrl);
    const html = buildOfferHtml(contract, buyer, baseUrl);
    const subject = `SYS_ALERT: ASSET_ALLOCATION | APN: ${contract.zip ?? "N/A"} | STATUS: AWAITING_EXECUTION`;

    const { sendM2MEmail } = await import("./email.server");
    const res = await sendM2MEmail({
      to: buyer.contact_email,
      subject,
      text,
      html,
      headers: {
        "X-Asset-ID": contract.id,
        "X-Buyer-ID": buyer.id ?? "",
        "X-Dispatch-From": gmailSender(),
      },
      replyTo: gmailSender(),
    });

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await supabaseAdmin.from("offer_delivery_logs").insert({
      contract_id: contract.id,
      buyer_id: buyer.id ?? null,
      recipient_email: buyer.contact_email,
      subject,
      status: res.ok ? "DELIVERED" : "REJECTED",
      reason_code: res.ok ? null : "CUSTOM_OTHER",
      provider_message_id: res.ok ? res.id : null,
      meta: res.ok
        ? {}
        : ({
            failure_enum: "TRANSPORT_SEND_FAILED" as DispatchFailureEnum,
            detail: res.error ?? null,
            failed_at: new Date().toISOString(),
          } as never),
    } as never);

    return res.ok
      ? { ok: true, id: res.id }
      : { ok: false, error: res.error, failure: "TRANSPORT_SEND_FAILED" };
  } catch (e) {
    const msg = (e as Error).message ?? String(e);
    const failure: DispatchFailureEnum = /title.*(key|credential)/i.test(msg)
      ? "TITLE_CREDENTIALS_MISSING"
      : "UNHANDLED_EXCEPTION";
    console.error("[dispatch-gmail] failed", failure, e);
    await logRejection(contract, buyer, failure, msg);
    return { ok: false, error: msg, failure };
  }
}
