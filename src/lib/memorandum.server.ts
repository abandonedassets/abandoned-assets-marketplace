// Memorandum of Purchase Agreement — auto-generated on seller signature.
// Bound to the property APN so the recorded instrument clouds title and blocks
// circumvention. Fail-forward: never blocks the signature path.

const s = (v: unknown) => (v == null || v === "" ? "—" : String(v));

export async function generateMemorandum(assetId: string, signerName?: string | null) {
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: row } = await supabaseAdmin
      .from("closing_pipeline_items")
      .select("id,apn,address,city,state,zip,base_contract_price,marketing_auth_signed_at")
      .eq("id", assetId)
      .maybeSingle();
    if (!row) return { ok: false as const, error: "asset_not_found" };
    const r = row as Record<string, any>;

    const { PDFDocument, StandardFonts, rgb } = await import("pdf-lib");
    const doc = await PDFDocument.create();
    const page = doc.addPage([612, 792]);
    const bold = await doc.embedFont(StandardFonts.HelveticaBold);
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const ink = rgb(0.05, 0.07, 0.1);
    let y = 730;
    const line = (t: string, size = 11, f = font) => {
      page.drawText(t, { x: 54, y, size, font: f, color: ink });
      y -= size + 8;
    };

    line("MEMORANDUM OF PURCHASE AGREEMENT", 16, bold);
    line(`Recorded notice of equitable interest — APN ${s(r["apn"])}`, 10);
    y -= 8;
    line(`Property APN:        ${s(r["apn"])}`);
    line(`Property:            ${s(r["address"])}`);
    line(`Jurisdiction:        ${s(r["city"])}, ${s(r["state"])} ${s(r["zip"])}`);
    line(`Seller signatory:    ${s(signerName)}`);
    line(`Agreement date:      ${s(r["marketing_auth_signed_at"] ?? new Date().toISOString())}`);
    line(`Equitable holder:    ReelEdge Entertainment LLC`);
    y -= 10;
    line(
      "Notice is hereby given that the undersigned holds an equitable interest in the",
      10,
    );
    line(
      "above-described parcel under a binding purchase and assignment agreement. Any",
      10,
    );
    line(
      "conveyance, encumbrance or assignment of said parcel is subject to satisfaction of",
      10,
    );
    line("that interest at closing through escrow.", 10);

    const bytes = await doc.save();
    const path = `${assetId}/memorandum-${Date.now()}.pdf`;
    const up = await supabaseAdmin.storage
      .from("memoranda")
      .upload(path, bytes, { contentType: "application/pdf", upsert: true });

    await supabaseAdmin.from("system_audit_logs").insert({
      pipeline_item_id: assetId,
      event_type: "MEMORANDUM_GENERATED",
      reason: "Memorandum of Purchase Agreement generated on seller signature",
      payload: {
        apn: r["apn"] ?? null,
        storage_path: up.error ? null : path,
        error: up.error?.message ?? null,
      },
    } as never);

    return { ok: !up.error, path: up.error ? null : path, error: up.error?.message ?? null };
  } catch (e) {
    return { ok: false as const, error: (e as Error).message };
  }
}
