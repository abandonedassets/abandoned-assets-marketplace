// Algorithmic clouding of title. On A-to-B execution the system mints a
// Memorandum of Contract (Affidavit of Equitable Interest), queues digital
// notarization, and pushes it to the county e-recording API (Simplifile-style).
// Fail-forward: recording failures never stall the monetization path.

import { EQUITABLE_INTEREST_CLAUSE } from "./risk-clauses.server";

async function sha256(s: string): Promise<string> {
  const d = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)));
  return Array.from(d)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export function buildMemorandum(deal: Record<string, any>): string {
  const address = [deal.address, deal.city, deal.state, deal.zip].filter(Boolean).join(", ");
  return [
    "MEMORANDUM OF CONTRACT / AFFIDAVIT OF EQUITABLE INTEREST",
    "",
    `Property: ${address || "See APN"}`,
    `APN: ${deal.apn ?? "N/A"}`,
    `County: ${deal.county ?? "N/A"}`,
    `Record Owner: ${deal.owner_entity ?? "Of record"}`,
    "Equitable Interest Holder (Buyer/Assignor): ReelEdge Entertainment LLC",
    `Contract Date: ${new Date().toISOString().slice(0, 10)}`,
    "",
    "NOTICE IS HEREBY GIVEN that the undersigned holds a valid and enforceable purchase",
    "agreement covering the above-described real property, and thereby holds equitable",
    "title pursuant to the doctrine of equitable conversion. Any subsequent purchaser or",
    "encumbrancer takes with actual and constructive notice of this interest.",
    "",
    EQUITABLE_INTEREST_CLAUSE,
    "",
    "This Memorandum is released only by a recorded release executed by the Interest Holder.",
  ].join("\n");
}

/** Idempotent: one active (unreleased) recording per asset. */
export async function cloudTitle(dealId: string) {
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: deal } = await supabaseAdmin
      .from("closing_pipeline_items")
      .select("id, address, city, state, zip, apn, county, owner_entity")
      .eq("id", dealId)
      .maybeSingle();
    if (!deal) return { ok: false as const, error: "deal_not_found" };

    const d = deal as Record<string, any>;

    // Geo-fence: OK SB 1075 (and any state flagged blockErecording) criminalizes
    // recording an instrument that clouds title. Never fire the recorder there.
    const { assessState } = await import("./geo-compliance.server");
    const rule = assessState(d.state);
    if (rule.blockErecording) {
      await supabaseAdmin
        .from("closing_pipeline_items")
        .update({ erecording_blocked: true, compliance_tier: rule.tier } as never)
        .eq("id", dealId);
      const { writeAuditLog } = await import("./webhook-verify.server");
      await writeAuditLog({
        event_type: "ERECORDING_GEOFENCED",
        reason: `state_blocked:${rule.state}`,
        pipeline_item_id: dealId,
        raw_payload: { state: rule.state, note: rule.note } as never,
      }).catch(() => {});
      return { ok: true as const, skipped: true as const, reason: rule.note };
    }

    const text = buildMemorandum(d);
    const hash = await sha256(text);


    const { data: existing } = await supabaseAdmin
      .from("title_cloud_recordings")
      .select("id, recording_status")
      .eq("pipeline_item_id", dealId)
      .is("released_at", null)
      .maybeSingle();
    if (existing) return { ok: true as const, id: (existing as any).id, reused: true };

    const { data: row, error } = await supabaseAdmin
      .from("title_cloud_recordings")
      .insert({
        pipeline_item_id: dealId,
        document_text: text,
        document_hash: hash,
        county: d.county ?? null,
        apn: d.apn ?? null,
      } as never)
      .select("id")
      .single();
    if (error) return { ok: false as const, error: error.message };

    const submitted = await submitToRecorder((row as any).id, text, d);
    return { ok: true as const, id: (row as any).id, reused: false, submitted };
  } catch (e) {
    console.error("[title-cloud] failed", e);
    return { ok: false as const, error: e instanceof Error ? e.message : String(e) };
  }
}

/** Pushes to the e-recording provider when credentials exist; otherwise stays queued. */
export async function submitToRecorder(
  recordingId: string,
  text: string,
  deal: Record<string, any>,
): Promise<{ dispatched: boolean; status: string }> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const url = process.env.ERECORDING_API_URL;
  const key = process.env.ERECORDING_API_KEY;
  if (!url || !key) {
    await supabaseAdmin
      .from("title_cloud_recordings")
      .update({ recording_status: "Queued", last_error: "erecording_not_configured" } as never)
      .eq("id", recordingId);
    return { dispatched: false, status: "Queued" };
  }
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        document_type: "MEMORANDUM_OF_CONTRACT",
        county: deal.county ?? null,
        apn: deal.apn ?? null,
        property_address: [deal.address, deal.city, deal.state, deal.zip].filter(Boolean).join(", "),
        notarization: "REMOTE_ONLINE",
        document_text: text,
      }),
      signal: AbortSignal.timeout(20000),
    });
    const body = await res.text();
    if (!res.ok) {
      await supabaseAdmin
        .from("title_cloud_recordings")
        .update({
          recording_status: "Failed",
          last_error: `[${res.status}] ${body.slice(0, 500)}`,
        } as never)
        .eq("id", recordingId);
      return { dispatched: false, status: "Failed" };
    }
    let ref: string | null = null;
    try {
      ref = (JSON.parse(body)?.recording_id ?? JSON.parse(body)?.id ?? null) as string | null;
    } catch {}
    await supabaseAdmin
      .from("title_cloud_recordings")
      .update({
        recording_status: "Submitted",
        recording_ref: ref,
        notary_status: "Submitted",
        last_error: null,
      } as never)
      .eq("id", recordingId);
    return { dispatched: true, status: "Submitted" };
  } catch (e) {
    await supabaseAdmin
      .from("title_cloud_recordings")
      .update({
        recording_status: "Failed",
        last_error: e instanceof Error ? e.message : String(e),
      } as never)
      .eq("id", recordingId);
    return { dispatched: false, status: "Failed" };
  }
}
