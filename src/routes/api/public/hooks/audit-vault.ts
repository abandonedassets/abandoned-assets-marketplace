// Off-platform audit vault export.
// Signed contracts, execution evidence, and SHA-256 non-repudiation hashes are
// pushed to external S3 storage so a platform-level loss never destroys the
// evidentiary record. Fail-forward: failures queue and retry, never stall.
import { createFileRoute } from "@tanstack/react-router";

const API_URL = "https://connector-gateway.lovable.dev";

async function signedUploadUrl(objectKey: string): Promise<string | null> {
  const lovableKey = process.env.LOVABLE_API_KEY;
  const s3Key = process.env.AWS_S3_API_KEY;
  if (!lovableKey || !s3Key) return null;
  const res = await fetch(`${API_URL}/api/v1/sign_storage_url?provider=aws_s3&mode=write`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${lovableKey}`,
      "X-Connection-Api-Key": s3Key,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ object_path: objectKey }),
  });
  if (!res.ok) {
    console.error(`[audit-vault] sign failed [${res.status}]: ${await res.text()}`);
    return null;
  }
  const j: any = await res.json();
  return j?.url ?? null;
}

export const Route = createFileRoute("/api/public/hooks/audit-vault")({
  server: {
    handlers: {
      GET: async () => Response.json({ ok: true, hint: "POST to run the audit vault export" }),
      POST: async () => {
        try {
          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
          const { data: rows } = await supabaseAdmin
            .from("esign_requests")
            .select(
              "id, pipeline_item_id, buyer_email, buyer_entity, signer_name, signer_ip, signer_user_agent, device_fingerprint, signed_at, assignment_fee, ofac_status, nonrepudiation_hash, invoice_url, w9_legal_name, w9_tax_classification, w9_tin_last4, w9_certified_at",
            )
            .not("signed_at", "is", null)
            .order("signed_at", { ascending: false })
            .limit(50);

          const list = (rows ?? []) as any[];
          if (list.length === 0) return Response.json({ ok: true, exported: 0, pending: 0 });

          const { data: done } = await supabaseAdmin
            .from("audit_vault_exports")
            .select("esign_id")
            .eq("status", "Exported");
          const seen = new Set(((done ?? []) as any[]).map((d) => d.esign_id));
          const todo = list.filter((r) => !seen.has(r.id));

          let exported = 0;
          let queued = 0;
          for (const r of todo) {
            const key = `reeledge/audit-vault/${String(r.signed_at).slice(0, 10)}/${r.id}.json`;
            const body = JSON.stringify(
              { document: "EXECUTION_EVIDENCE_RECORD", exported_at: new Date().toISOString(), ...r },
              null,
              2,
            );
            let status = "Pending";
            let lastError: string | null = null;
            try {
              const url = await signedUploadUrl(key);
              if (!url) {
                lastError = "s3_not_configured";
              } else {
                const put = await fetch(url, {
                  method: "PUT",
                  body,
                  headers: { "Content-Type": "application/json" },
                });
                if (put.ok) status = "Exported";
                else lastError = `upload_failed_${put.status}`;
              }
            } catch (e) {
              lastError = e instanceof Error ? e.message : String(e);
            }
            if (status === "Exported") exported++;
            else queued++;

            await supabaseAdmin.from("audit_vault_exports").upsert(
              {
                esign_id: r.id,
                pipeline_item_id: r.pipeline_item_id,
                object_key: key,
                evidence_hash: r.nonrepudiation_hash ?? null,
                status,
                last_error: lastError,
                exported_at: status === "Exported" ? new Date().toISOString() : null,
              } as never,
              { onConflict: "esign_id" },
            );
          }

          return Response.json({ ok: true, exported, queued, at: new Date().toISOString() });
        } catch (e) {
          console.error("[audit-vault] failed", e);
          return Response.json(
            { ok: false, error: e instanceof Error ? e.message : String(e) },
            { status: 200 },
          );
        }
      },
    },
  },
});
