// Autonomous Buyer Closing & Signature Cascade — public one-click execution.
import { createServerFn } from "@tanstack/react-start";

export type ContractSheet = {
  ok: boolean;
  error?: string;
  deal_id?: string;
  status?: string;
  tif_state?: string | null;
  tif_expires_at?: string | null;
  payload?: Record<string, any> | null;
};

export const getContractSheet = createServerFn({ method: "GET" })
  .inputValidator((d: { id: string }) => d)
  .handler(async ({ data }): Promise<ContractSheet> => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: row } = await supabaseAdmin
      .from("closing_pipeline_items")
      .select(
        "id,status,tif_state,tif_expires_at,contract_payload,address,city,state,zip,apn,asset_type,base_contract_price,optimized_acquisition_premium,lien_total,assessed_value,title_status,confidence_score",
      )
      .eq("id", data.id)
      .maybeSingle();
    if (!row) return { ok: false, error: "not_found" };
    const d = row as any;

    let payload = d.contract_payload;
    if (!payload) {
      const { data: built } = await supabaseAdmin.rpc("assemble_contract_payload" as never, {
        _id: d.id,
        _box_id: null,
      } as never);
      payload = built ?? null;
      if (payload) {
        await supabaseAdmin
          .from("closing_pipeline_items")
          .update({ contract_payload: payload } as never)
          .eq("id", d.id);
      }
    }

    // Retroactive redaction: exact address / GPS / seller detail stay locked
    // until the buyer executes the assignment agreement.
    const executed = String(d.tif_state ?? "") === "Executed";
    if (!executed) {
      const { maskContractPayload } = await import("./address-mask");
      payload = maskContractPayload(payload);
    }

    return {
      ok: true,
      deal_id: d.id,
      status: String(d.status),
      tif_state: d.tif_state,
      tif_expires_at: d.tif_expires_at,
      payload,
    };
  });

export const executeContract = createServerFn({ method: "POST" })
  .inputValidator((d: { id: string; signerName: string; buyerEmail: string }) => d)
  .handler(async ({ data }) => {
    if (!data.signerName?.trim() || !data.buyerEmail?.includes("@"))
      return { ok: false, error: "signer_name_and_email_required" };

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: res, error } = await supabaseAdmin.rpc("execute_buyer_contract" as never, {
      _id: data.id,
      _signer_name: data.signerName.trim(),
      _buyer_email: data.buyerEmail.trim(),
      _ip: null,
    } as never);
    if (error) return { ok: false, error: error.message };
    const out = res as any;
    if (!out?.ok) return out;

    // Atomic-ish EMD hold — fail-forward: signature stands, hold retried by rails sweep.
    let emd: any = { status: "queued" };
    try {
      const { issueAchDebit } = await import("./bluevine-rails.server");
      const rail = await issueAchDebit({
        dealId: data.id,
        amountUsd: 1000,
        memo: `EMD hold — ${data.id}`,
        counterpartyRef: data.buyerEmail.trim(),
        idempotencyKey: `emd_sign_${data.id}`,
      });
      emd = rail.ok ? { status: "authorized", ref: rail.id } : { status: "pending", error: rail.error };
    } catch (e) {
      emd = { status: "pending", error: String(e) };
    }

    return { ...out, emd };
  });
