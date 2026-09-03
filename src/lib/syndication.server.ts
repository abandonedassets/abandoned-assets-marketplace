import { maskedLabel } from "./address-mask";
// Reach Loop — Automated Buyer Traffic & Outbound Syndication.
// Fires the instant an asset lands in Webhook_Dispatched:
//   1. Twilio SMS to matched / tiered buyers (via Lovable connector gateway)
//   2. Transactional email with the direct-buy link
//   3. Machine webhook fan-out (routing_endpoints + Discord/Telegram feeds)
// Fail-forward: every channel is wrapped; a failure never stalls the pipeline.

const GATEWAY = "https://connector-gateway.lovable.dev";

export type SyndicationAsset = {
  id: string;
  address: string | null;
  city?: string | null;
  state?: string | null;
  zip: string | null;
  asset_type: string | null;
  base_contract_price: number | null;
  optimized_acquisition_premium: number | null;
  matched_buyer_id?: string | null;
  buyer_tier_stage?: string | null;
};

export type SyndicationResult = {
  deal_id: string;
  buy_link: string;
  sms: number;
  sms_skipped?: number;
  emails: number;
  webhooks: number;
};

function baseUrl(): string {
  return process.env.PUBLIC_APP_URL || "https://asset-weaver-30.lovable.app";
}

async function logAlert(input: {
  dealId: string;
  channel: string;
  target: string | null;
  status: string;
  error?: string | null;
  payload?: Record<string, unknown>;
}) {
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await supabaseAdmin.from("outbound_alert_log" as never).insert({
      pipeline_item_id: input.dealId,
      channel: input.channel,
      target: input.target,
      status: input.status,
      error: input.error ?? null,
      payload: (input.payload ?? {}) as never,
    } as never);
  } catch (e) {
    console.error("[syndication] alert log failed", e);
  }
}

/** True when SMS execution is explicitly disabled or unconfigured. */
export function smsDisabledReason(): string | null {
  if (process.env.SMS_ENABLED === "false") return "sms_disabled_flag";
  if ((process.env.DISPATCH_PROVIDER ?? "").toUpperCase() === "WEBHOOK_ONLY")
    return "dispatch_provider_webhook_only";
  if (!process.env.LOVABLE_API_KEY) return "missing_lovable_api_key";
  if (!process.env.TWILIO_API_KEY) return "missing_twilio_api_key";
  if (!process.env.TWILIO_FROM_NUMBER) return "missing_twilio_from_number";
  return null;
}

/** Twilio SMS through the connector gateway. Silent no-op when unconfigured. */
export async function sendSms(to: string, body: string): Promise<boolean> {
  if (smsDisabledReason()) return false;
  const lovableKey = process.env.LOVABLE_API_KEY!;
  const twilioKey = process.env.TWILIO_API_KEY!;
  const from = process.env.TWILIO_FROM_NUMBER!;


  try {
    const res = await fetch(`${GATEWAY}/twilio/Messages.json`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${lovableKey}`,
        "X-Connection-Api-Key": twilioKey,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({ To: to, From: from, Body: body.slice(0, 600) }),
    });
    if (!res.ok) {
      console.error(`[syndication] twilio failed [${res.status}]: ${await res.text()}`);
      return false;
    }
    return true;
  } catch (e) {
    console.error("[syndication] twilio transport error", e);
    return false;
  }
}

/** Post the dispatched JSON payload to every active machine endpoint. */
async function fanOutWebhooks(
  dealId: string,
  payload: Record<string, unknown>,
): Promise<number> {
  const targets: { name: string; url: string }[] = [];
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data } = await supabaseAdmin
      .from("routing_endpoints")
      .select("name,url")
      .eq("is_active", true)
      .order("priority_score", { ascending: false })
      .limit(50);
    for (const r of (data ?? []) as any[]) targets.push({ name: r.name, url: r.url });
  } catch (e) {
    console.error("[syndication] endpoint fetch failed", e);
  }
  const discord = process.env.INVESTOR_DISCORD_WEBHOOK_URL;
  if (discord) targets.push({ name: "discord_investor_feed", url: discord });
  const telegramToken = process.env.TELEGRAM_BOT_TOKEN;
  const telegramChat = process.env.TELEGRAM_CHAT_ID;

  let ok = 0;
  for (const t of targets) {
    try {
      const isDiscord = t.url.includes("discord.com/api/webhooks");
      const body = isDiscord
        ? JSON.stringify({
            content: `🟢 NEW ASSET — ${payload["address"] ?? "—"}\nPrice: $${payload["base_contract_price"]}  |  Fee: $${payload["assignment_fee"]}\nBuy now: ${payload["buy_link"]}`,
          })
        : JSON.stringify(payload);
      const { payloadIntegrityHash } = await import("@/lib/quant-alpha.server");
      const res = await fetch(t.url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Payload-Integrity-Hash": payloadIntegrityHash(body),
        },
        body,
      });
      if (res.ok) ok++;
      await logAlert({
        dealId,
        channel: "webhook",
        target: t.name,
        status: res.ok ? "sent" : "failed",
        error: res.ok ? null : `http_${res.status}`,
      });
    } catch (e) {
      await logAlert({
        dealId,
        channel: "webhook",
        target: t.name,
        status: "failed",
        error: String(e),
      });
    }
  }

  if (telegramToken && telegramChat) {
    try {
      const res = await fetch(`https://api.telegram.org/bot${telegramToken}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: telegramChat,
          text: `NEW ASSET — ${payload["address"] ?? "—"}\nPrice: $${payload["base_contract_price"]} | Fee: $${payload["assignment_fee"]}\n${payload["buy_link"]}`,
          disable_web_page_preview: false,
        }),
      });
      if (res.ok) ok++;
      await logAlert({
        dealId,
        channel: "telegram",
        target: "investor_feed",
        status: res.ok ? "sent" : "failed",
      });
    } catch (e) {
      await logAlert({ dealId, channel: "telegram", target: "investor_feed", status: "failed", error: String(e) });
    }
  }
  return ok;
}

/** Reject placeholder/test addresses — production dispatch is live-only. */
function isLiveEmail(e: string | null | undefined): boolean {
  if (!e) return false;
  const v = e.trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[a-z]{2,}$/.test(v)) return false;
  return !/(^|[.@+_-])(test|mock|demo|sample|placeholder|dummy|noreply|no-reply)([.@+_-]|$)/.test(v)
    && !/@(example\.(com|org|net)|test\.|localhost)/.test(v);
}

/** First time this asset was dispatched to anyone (ms epoch), or null. */
async function firstDispatchAt(dealId: string): Promise<number | null> {
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data } = await supabaseAdmin
      .from("outbound_alert_log")
      .select("created_at")
      .eq("pipeline_item_id", dealId)
      .order("created_at", { ascending: true })
      .limit(1);
    const ts = (data as any[] | null)?.[0]?.created_at;
    return ts ? new Date(ts).getTime() : null;
  } catch {
    return null;
  }
}

/** Buyers to alert for this asset, tier-aware and ZIP-aware. Live contacts only. */
async function targetBuyers(asset: SyndicationAsset) {
  const tier = asset.buyer_tier_stage ?? "primary";
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data } = await supabaseAdmin
      .from("buyer_waitlist")
      .select("id,fund_name,contact_email,contact_phone,target_zips,buyer_tier,status")
      .neq("status", "rejected")
      .limit(500);
    const rows = ((data ?? []) as any[]).filter(
      (b) => isLiveEmail(b.contact_email) || !!b.contact_phone,
    );

    const pool = rows.filter((b) =>
      tier === "secondary" ? true : (b.buyer_tier ?? "primary") === "primary",
    );
    const zipMatched = pool.filter((b) => {
      const zips: string[] = b.target_zips ?? [];
      return zips.length === 0 || (asset.zip ? zips.includes(asset.zip) : false);
    });
    const selected = (zipMatched.length ? zipMatched : pool).slice(0, 100);

    // --- Tiered dispatch: scorecard rank + 30-minute priority head start ---
    try {
      const { rankBuyers, PRIORITY_HEAD_START_MS } = await import("@/lib/scorecard.server");
      const ranked = await rankBuyers(
        selected.map((b) => String(b.contact_email ?? "")).filter(Boolean),
      );
      const meta = new Map(ranked.map((r) => [r.email, r]));

      // purged buyers never dispatch
      const alive = selected.filter((b) => {
        const e = String(b.contact_email ?? "").trim().toLowerCase();
        return !e || meta.has(e);
      });

      const ordered = alive.sort((a, b) => {
        const ra = meta.get(String(a.contact_email ?? "").trim().toLowerCase());
        const rb = meta.get(String(b.contact_email ?? "").trim().toLowerCase());
        const ta = ra?.tier === "priority" ? 0 : 1;
        const tb = rb?.tier === "priority" ? 0 : 1;
        if (ta !== tb) return ta - tb;
        return (rb?.score ?? 100) - (ra?.score ?? 100);
      });

      const priority = ordered.filter(
        (b) => meta.get(String(b.contact_email ?? "").trim().toLowerCase())?.tier === "priority",
      );
      if (priority.length === 0) return ordered; // zero-friction: nobody to hold for

      const startedAt = await firstDispatchAt(asset.id);
      const windowOpen =
        startedAt !== null && Date.now() - startedAt >= PRIORITY_HEAD_START_MS;
      return windowOpen ? ordered : priority; // first drop = priority only
    } catch (e) {
      console.error("[syndication] tiering skipped", (e as Error).message);
      return selected;
    }
  } catch (e) {
    console.error("[syndication] buyer fetch failed", e);
    return [];
  }
}



/** Full reach-loop dispatch for one asset. Never throws. */
export async function syndicateAsset(asset: SyndicationAsset): Promise<SyndicationResult> {
  const price = Number(asset.base_contract_price ?? 0);
  const fee = Number(asset.optimized_acquisition_premium ?? 0);
  const rawBuy = `${baseUrl()}/api/public/checkout/create-session?deal=${asset.id}`;
  let buyLink = rawBuy;
  try {
    const { generateTrackedLink } = await import("@/lib/links");
    buyLink = generateTrackedLink({
      assetId: asset.id,
      buyer: asset.matched_buyer_id ?? "",
      target: rawBuy,
      baseUrl: baseUrl(),
    });
  } catch {
    /* tracked link optional */
  }

  const label = maskedLabel({ address: asset.address, zip: asset.zip, apn: (asset as any).apn });
  const payload: Record<string, unknown> = {
    deal_id: asset.id,
    address: label,
    masked: true,
    apn: (asset as any).apn ?? null,
    city: null,
    state: asset.state ?? null,
    zip: asset.zip,
    asset_type: asset.asset_type,
    base_contract_price: price,
    offer_price: price,
    assignment_fee: fee,
    total_to_buyer: price + fee,
    buyer_tier: asset.buyer_tier_stage ?? "primary",
    buy_link: buyLink,
    marketplace_url: `${baseUrl()}/marketplace`,
    dispatched_at: new Date().toISOString(),
  };

  // Enrich with the same underwriting/trust keys the /api/v1/deals/stream spec
  // publishes, so machine intakes see one canonical payload shape. Fail-forward.
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: full } = await supabaseAdmin
      .from("closing_pipeline_items")
      .select("*")
      .eq("id", asset.id)
      .maybeSingle();
    if (full) {
      const r = full as Record<string, any>;
      const arv = Number(r["assessed_value"]) || 0;
      const repairs = Number(r["estimated_repairs"]) || 0;
      payload["arv"] = arv;
      payload["estimated_repairs"] = repairs;
      payload["spread"] = arv > 0 ? Number((arv * 0.7 - repairs - price).toFixed(2)) : null;
      payload["title_status"] = r["title_status"] ?? null;
      payload["confidence_score"] = r["confidence_score"] ?? null;
      payload["liquidity_bucket"] = r["liquidity_bucket"] ?? null;
      payload["contract_state"] = r["contract_state"] ?? "UNSENT";
      payload["has_signed_marketing_auth"] = !!r["has_signed_marketing_auth"];
      // Escrow of record: per-asset entity, else the project default. Funds
      // will not wire EMD to a packet with no named title company.
      let toc = (r["title_company_of_record"] ?? null) as Record<string, unknown> | null;
      if (!toc) {
        const { data: cfg } = await supabaseAdmin
          .from("system_config")
          .select("value")
          .eq("key", "title_company_of_record")
          .maybeSingle();
        toc = ((cfg as { value?: Record<string, unknown> } | null)?.value ?? null) as never;
      }
      payload["title_company_of_record"] = toc;
      payload["escrow_verified"] = !!(toc && toc["name"] && toc["wire_instructions_verified"]);
      try {
        const trust = await import("@/lib/trust-metrics.server");
        payload["title_purity_score"] = trust.titlePurityScore(r as any)?.title_purity_score ?? null;
        payload["fema_zone_clear"] = trust.femaClearance(r as any)?.fema_zone_clear !== false;
        payload["projected_post_sale_tax"] = Math.round(
          trust.projectedPostSaleTax(r as any)?.projected_post_sale_tax ?? 0,
        );
      } catch {
        /* trust metrics optional */
      }
    }
    const { vdrUrl } = await import("@/lib/vdr.server");
    payload["vdr_url"] = await vdrUrl(baseUrl(), asset.id);
  } catch (e) {
    console.error("[syndication] payload enrichment failed", asset.id, e);
  }

  // Stage 3 — dedicated inbound FBO wire coordinates travel WITH the tape so
  // institutional treasury desks have a deterministic destination per asset.
  try {
    const { ensureFboAccount } = await import("@/lib/fbo.server");
    const fbo = await ensureFboAccount(asset.id, price + fee);
    if (fbo) {
      payload["wire_instructions"] = {
        beneficiary_name: fbo.fbo_name,
        bank_name: fbo.bank_name,
        account_number: fbo.fbo_account_number,
        routing_number: fbo.routing_number,
        amount_usd: price + fee,
        reference: `DEAL-${asset.id.slice(0, 8).toUpperCase()}`,
        notification_webhook: `${baseUrl()}/api/public/hooks/inbound-wire-received`,
      };
    }
  } catch (e) {
    console.error("[syndication] fbo mint failed", asset.id, e);
  }

  // DMA quantitative alpha block — pre-trade risk clearance + TCA metrics.
  try {
    const { buildQuantitativeAlphaBlock } = await import("@/lib/quant-alpha.server");
    payload["quantitative_alpha_block"] = buildQuantitativeAlphaBlock({
      strike_price: price,
      assignment_fee: fee,
      arv: payload["arv"],
      title_status: payload["title_status"] ?? "Insured",
    });
  } catch (e) {
    console.error("[syndication] alpha block failed", asset.id, e);
  }


  const buyers = await targetBuyers(asset);
  if (buyers.length === 0) {
    await logAlert({
      dealId: asset.id,
      channel: "email",
      target: null,
      status: "halted",
      error: "no_live_buyer_contact",
    });
  }

  const smsOff = smsDisabledReason();
  let sms = 0;
  let smsSkipped = 0;
  let emails = 0;

  let buyerIndex = 0;
  for (const b of buyers) {
    if (b.contact_phone) {
      if (smsOff) {
        // Graceful fallback: never block the pipeline on telephony config.
        smsSkipped++;
        await logAlert({
          dealId: asset.id,
          channel: "sms",
          target: b.fund_name ?? b.id,
          status: "skipped",
          error: smsOff,
        });
      } else {
        const okSms = await sendSms(
          b.contact_phone,
          `New off-market asset: ${label}. $${Math.round(price).toLocaleString()} + $${Math.round(fee).toLocaleString()} fee. Secure it: ${buyLink}`,
        );
        if (okSms) sms++;
        await logAlert({
          dealId: asset.id,
          channel: "sms",
          target: b.fund_name ?? b.id,
          status: okSms ? "sent" : "failed",
        });
      }
    }

    if (isLiveEmail(b.contact_email)) {
      try {
        const { assetHeaders, jsonBlock } = await import("@/lib/email.server");
        const { enqueueDispatch } = await import("@/lib/dispatch-queue.server");
        const queued = await enqueueDispatch({
          dealId: asset.id,
          target: b.contact_email,
          index: buyerIndex++,
          subject: `[DIRECT-BUY] ${label} — $${Math.round(price).toLocaleString()}`,
          html: `
            <h2>New Off-Market Asset Dispatched</h2>
            <p><strong>${label}</strong><br/>
            Contract price: $${Math.round(price).toLocaleString()}<br/>
            Assignment fee: $${Math.round(fee).toLocaleString()}<br/>
            Total to buyer: $${Math.round(price + fee).toLocaleString()}</p>
            <p><a href="${buyLink}" style="background:#0b6;color:#fff;padding:12px 18px;border-radius:6px;text-decoration:none">Execute Direct Buy</a></p>
            ${jsonBlock(payload)}
          `,
          headers: assetHeaders({
            assetId: asset.id,
            dealType: asset.asset_type ?? "LAND",
            assignmentFee: fee,
            action: "DIRECT_BUY",
          }) as unknown as Record<string, string>,
        });
        if (queued) {
          emails++;
          await logAlert({
            dealId: asset.id,
            channel: "email",
            target: b.contact_email,
            status: "queued",
          });
        }
        // Duplicate enqueue = idempotency hit; drop silently, no log spam.
      } catch (e) {
        await logAlert({
          dealId: asset.id,
          channel: "email",
          target: b.contact_email,
          status: "failed",
          error: String(e),
        });
      }
    }
  }


  const webhooks = await fanOutWebhooks(asset.id, payload);

  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await supabaseAdmin
      .from("closing_pipeline_items")
      .update({ syndicated_at: new Date().toISOString() } as never)
      .eq("id", asset.id);
  } catch (e) {
    console.error("[syndication] stamp failed", e);
  }

  return { deal_id: asset.id, buy_link: buyLink, sms, sms_skipped: smsSkipped, emails, webhooks };
}
