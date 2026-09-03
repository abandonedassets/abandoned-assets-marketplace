// Zero-Touch Title Escrow Injection — once the assignment fee is captured we
// autonomously open escrow with the digital title provider. Fail-forward:
// a provider outage never blocks the money event; the row is logged for replay.

const TIMEOUT_MS = 8000;

function endpoint() {
  return process.env["TITLE_API_URL"] ?? "https://api.qualia.com/v1/orders";
}

function apiKey() {
  return process.env["TITLE_API_KEY"] ?? "";
}

export async function injectEscrowOrder(
  dealId: string,
): Promise<{ ok: boolean; status?: number; order_ref?: string | null; error?: string }> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

  // Idempotency: never open the same escrow twice.
  const { data: prior } = await supabaseAdmin
    .from("escrow_injections")
    .select("id,status,order_ref")
    .eq("pipeline_item_id", dealId)
    .eq("status", "OPENED")
    .maybeSingle();
  if (prior) return { ok: true, order_ref: (prior as any).order_ref ?? null };

  const { data: deal } = await supabaseAdmin
    .from("closing_pipeline_items")
    .select(
      "id, address, city, state, zip, apn, asset_type, base_contract_price, optimized_acquisition_premium, seller_name, seller_email, buyer_entity_name, buyer_contact_email, signed_contract_hash",
    )
    .eq("id", dealId)
    .maybeSingle();
  if (!deal) return { ok: false, error: "deal_not_found" };
  const d = deal as Record<string, any>;

  const payload = {
    external_ref: String(d["id"]),
    order_type: "assignment_closing",
    property: {
      address: d["address"] ?? null,
      city: d["city"] ?? null,
      state: d["state"] ?? null,
      postal_code: d["zip"] ?? null,
      parcel_number: d["apn"] ?? null,
      property_type: d["asset_type"] ?? null,
    },
    financials: {
      purchase_price: Number(d["base_contract_price"] ?? 0),
      assignment_fee: Number(d["optimized_acquisition_premium"] ?? 0),
      currency: "USD",
    },
    parties: [
      { role: "seller", name: d["seller_name"] ?? null, email: d["seller_email"] ?? null },
      { role: "buyer", name: d["buyer_entity_name"] ?? null, email: d["buyer_contact_email"] ?? null },
    ],
    contract_hash: d["signed_contract_hash"] ?? null,
  };

  let status: number | null = null;
  let body = "";
  let orderRef: string | null = null;
  let error: string | null = null;

  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    if (!apiKey()) throw new Error("title_api_key_missing");
    const resp = await fetch(endpoint(), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey()}`,
        "X-Idempotency-Key": `escrow_${dealId}`,
      },
      body: JSON.stringify(payload),
      signal: ctrl.signal,
    });
    status = resp.status;
    body = (await resp.text()).slice(0, 2000);
    try {
      const j = JSON.parse(body);
      orderRef = j?.id ?? j?.order_id ?? j?.order_ref ?? null;
    } catch {
      /* non-json provider response */
    }
    if (!resp.ok) error = `http_${resp.status}`;
  } catch (e) {
    error = (e as Error).message;
  } finally {
    clearTimeout(t);
  }

  await supabaseAdmin
    .from("escrow_injections")
    .insert({
      pipeline_item_id: dealId,
      provider: "qualia",
      status: error ? "PENDING_RETRY" : "OPENED",
      http_status: status,
      order_ref: orderRef,
      request_payload: payload as never,
      response_body: body || null,
      error,
    } as never)
    .then(undefined, () => {});

  return error
    ? { ok: false, status: status ?? undefined, error }
    : { ok: true, status: status ?? undefined, order_ref: orderRef };
}
