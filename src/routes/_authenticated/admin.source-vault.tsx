import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState, type FormEvent } from "react";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/_authenticated/admin/source-vault")({
  head: () => ({ meta: [{ title: "REEL Edge Source Vault Intake" }, { name: "robots", content: "noindex,nofollow" }] }),
  component: SourceVaultIntakePage,
});

const EXPECTED_SHA256 = "78d67d27eee3f17ff97832c087f55477013254cdc51098a839a4081f91c0182b";
const EXPECTED_BYTES = 60426;
const FUNCTION_SLUG = "reel-edge-universal-source-vault-intake-v1";
const SOURCE_SYSTEM = "REEL_EDGE_CHATGPT_LIBRARY";
const SOURCE_RECORD_ID = "REELEDGE-SOLE-MEMBER-COMPENSATION-CONSENT-2026-10-06";
const SOURCE_VERSION = "2026-10-06-executed";

type Receipt = {
  status?: string; ingestion_status?: string; vault_object_id?: string;
  source_sha256?: string; stored_sha256?: string; extraction_started?: boolean;
  layer2_started?: boolean; layer3_started?: boolean; ledger_posting?: boolean;
  external_execution?: boolean; money_moved?: boolean; error?: string;
};

async function sha256(file: File) {
  const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
  return [...new Uint8Array(digest)].map((x) => x.toString(16).padStart(2, "0")).join("");
}

function SourceVaultIntakePage() {
  const [access, setAccess] = useState<"checking" | "allowed" | "denied">("checking");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [receipt, setReceipt] = useState<Receipt | null>(null);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const { data: u, error: ue } = await supabase.auth.getUser();
        if (ue || !u.user) { if (active) setAccess("denied"); return; }
        const { data: admin, error } = await supabase.rpc("has_role", { _user_id: u.user.id, _role: "admin" });
        if (active) setAccess(!error && admin === true ? "allowed" : "denied");
      } catch { if (active) setAccess("denied"); }
    })();
    return () => { active = false; };
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setMessage(""); setReceipt(null);
    if (!file) { setMessage("Choose the executed consent PDF."); return; }
    setBusy(true);
    try {
      if (file.size !== EXPECTED_BYTES) throw new Error(`Wrong file size: expected ${EXPECTED_BYTES}; got ${file.size}. Nothing uploaded.`);
      const localHash = await sha256(file);
      if (localHash !== EXPECTED_SHA256) throw new Error("SHA-256 mismatch. Nothing uploaded.");
      const { data: session, error: sessionError } = await supabase.auth.getSession();
      if (sessionError || !session.session?.access_token) throw new Error("Authenticated session missing. Sign in again.");
      const url = import.meta.env.VITE_SUPABASE_URL;
      const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
      if (!url || !key) throw new Error("Supabase client configuration missing.");
      const form = new FormData();
      form.set("file", file, file.name);
      form.set("source_system", SOURCE_SYSTEM);
      form.set("source_record_id", SOURCE_RECORD_ID);
      form.set("source_version", SOURCE_VERSION);
      form.set("provenance", JSON.stringify({ origin: "ChatGPT Library source file", original_filename: file.name, expected_sha256: EXPECTED_SHA256, intake_purpose: "Explicit source-vault staging only" }));
      const response = await fetch(`${url.replace(/\\/$/, "")}/functions/v1/${FUNCTION_SLUG}`, {
        method: "POST", headers: { Authorization: `Bearer ${session.session.access_token}`, apikey: key },
        body: form, cache: "no-store",
      });
      const body = (await response.json().catch(() => ({}))) as Receipt;
      if (!response.ok) throw new Error(body.error || `INTAKE_FAILED_HTTP_${response.status}`);
      if (body.status !== "STAGED_IN_VAULT" || body.ingestion_status !== "STAGED_IN_VAULT" ||
          body.source_sha256 !== EXPECTED_SHA256 || body.stored_sha256 !== EXPECTED_SHA256 ||
          body.extraction_started !== false || body.layer2_started !== false || body.layer3_started !== false ||
          body.ledger_posting !== false || body.external_execution !== false || body.money_moved !== false) {
        setReceipt(body);
        throw new Error("Receipt did not pass all staging/hash/no-execution checks. Do not retry blindly.");
      }
      setReceipt(body);
      setMessage("Verified: staged in the source vault; stored SHA-256 matches. No extraction or financial execution started.");
    } catch (e) { setMessage(e instanceof Error ? e.message : "INTAKE_FAILED"); }
    finally { setBusy(false); }
  }

  if (access !== "allowed") return <main className="min-h-screen bg-background p-6 text-foreground"><section className="mx-auto max-w-xl rounded-lg border border-border p-6"><h1 className="text-xl font-semibold">REEL Edge Source Vault</h1><p className="mt-3 text-sm text-muted-foreground">{access === "checking" ? "Checking administrator access…" : "Administrator access required. No file uploaded."}</p></section></main>;

  return <main className="min-h-screen bg-background p-4 text-foreground md:p-8"><section className="mx-auto max-w-2xl space-y-5 rounded-lg border border-border p-6">
    <header className="space-y-2"><p className="font-mono text-xs uppercase tracking-wider text-muted-foreground">Layer 1 · Explicit ingestion</p><h1 className="text-2xl font-semibold">REEL Edge Source Vault</h1><p className="text-sm text-muted-foreground">Verify the exact executed consent before staging. Intake does not start extraction, Layer 2, Layer 3, ledger posting, or payment.</p></header>
    <div className="rounded-md border border-border p-3 text-sm"><p><strong>Expected file:</strong> REELEDGE Sole Member Compensation Consent EXECUTED.pdf</p><p><strong>Size:</strong> 60,426 bytes</p><p className="break-all"><strong>SHA-256:</strong> {EXPECTED_SHA256}</p></div>
    <form onSubmit={submit} className="space-y-4"><label className="block space-y-2 text-sm font-medium">Select the PDF downloaded from your Library<input className="block w-full rounded-md border border-border p-3 text-sm" type="file" accept=".pdf,application/pdf" onChange={e => { setFile(e.currentTarget.files?.[0] ?? null); setMessage(""); setReceipt(null); }} disabled={busy} required /></label><button type="submit" disabled={busy || !file} className="rounded-md bg-primary px-4 py-2 font-medium text-primary-foreground disabled:opacity-50">{busy ? "Verifying and staging…" : "Verify and stage consent"}</button></form>
    {message && <p role="alert" className="rounded-md border border-border p-3 text-sm">{message}</p>}
    {receipt && <pre className="overflow-auto rounded-md border border-border p-3 text-xs">{JSON.stringify(receipt, null, 2)}</pre>}
  </section></main>;
}
