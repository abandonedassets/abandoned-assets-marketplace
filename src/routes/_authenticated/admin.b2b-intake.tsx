import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState, type FormEvent } from "react";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/_authenticated/admin/b2b-intake")({
  head: () => ({
    meta: [
      { title: "B2B Corporate Debt Intake" },
      { name: "robots", content: "noindex,nofollow" },
    ],
  }),
  component: B2BDebtIntakePage,
});

type IntakeResult = {
  claim_id?: string;
  document_object_id?: string;
  claim_status?: string;
  review_status?: string;
  document_sha256?: string;
  original_document_stored?: boolean;
  external_execution?: boolean;
  recognized_amount?: number;
  available_amount?: number;
  legal_assignability?: string;
  error?: string;
  code?: string | null;
  field?: string;
};

const ACCEPT = ".pdf,.png,.jpg,.jpeg,.tif,.tiff,.txt,.doc,.docx";

function B2BDebtIntakePage() {
  const [creditorEin, setCreditorEin] = useState("");
  const [debtorEin, setDebtorEin] = useState("");
  const [faceValue, setFaceValue] = useState("");
  const [terms, setTerms] = useState("NET-30");
  const [maturity, setMaturity] = useState("");
  const [assignmentClause, setAssignmentClause] = useState(false);
  const [assignmentRef, setAssignmentRef] = useState("");
  const [provenance, setProvenance] = useState("");
  const [document, setDocument] = useState<File | null>(null);
  const [fileInputKey, setFileInputKey] = useState(0);
  const [idempotencyKey, setIdempotencyKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<IntakeResult | null>(null);
  const [error, setError] = useState("");
  const [authorization, setAuthorization] = useState<"checking" | "allowed" | "denied">("checking");

  useEffect(() => {
    let active = true;
    async function verifyAdminAccess() {
      const { data: userData, error: userError } = await supabase.auth.getUser();
      if (userError || !userData.user) {
        if (active) setAuthorization("denied");
        return;
      }
      const { data: isAdmin, error: roleError } = await supabase.rpc("has_role", {
        _user_id: userData.user.id,
        _role: "admin",
      });
      if (active) setAuthorization(!roleError && isAdmin === true ? "allowed" : "denied");
    }
    void verifyAdminAccess();
    return () => {
      active = false;
    };
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setResult(null);
    if (!document) {
      setError("Attach the original invoice or contract document.");
      return;
    }
    if (creditorEin.replace(/-/g, "") === debtorEin.replace(/-/g, "")) {
      setError("Creditor and debtor EINs must be different.");
      return;
    }
    if (document.size <= 0 || document.size > 15 * 1024 * 1024) {
      setError("Document must be between 1 byte and 15 MB.");
      return;
    }
    if (!provenance.trim() || !assignmentRef.trim()) {
      setError("Source provenance and assignment-evidence reference are required.");
      return;
    }

    setBusy(true);
    try {
      const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;
      if (sessionError || !token) throw new Error("Sign in again before submitting.");
      const key = idempotencyKey || `b2b-${crypto.randomUUID()}`;
      setIdempotencyKey(key);
      const metadata = {
        creditor_corporate_ein: creditorEin.trim(),
        debtor_corporate_ein: debtorEin.trim(),
        invoice_face_value: faceValue,
        currency_code: "USD",
        net_payment_terms: terms,
        maturity_date: maturity,
        assignment_clause_present: assignmentClause,
        assignment_evidence_ref: assignmentRef.trim(),
        source_provenance: provenance.trim(),
        idempotency_key: key,
      };
      const form = new FormData();
      form.set("document", document, document.name);
      form.set("metadata", JSON.stringify(metadata));
      const response = await fetch("/api/private/b2b-intake", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: form,
        cache: "no-store",
      });
      const body = await response.json().catch(() => ({})) as IntakeResult;
      if (!response.ok || response.status !== 201) {
        const detail = body.field ? `${body.error ?? "INTAKE_FAILED"} (${body.field})` : body.error ?? `HTTP_${response.status}`;
        throw new Error(detail);
      }
      if (
        typeof body.claim_id !== "string" || !body.claim_id ||
        typeof body.document_object_id !== "string" || !body.document_object_id ||
        typeof body.document_sha256 !== "string" || !/^[0-9a-f]{64}$/.test(body.document_sha256) ||
        body.original_document_stored !== true ||
        body.external_execution !== false ||
        body.recognized_amount !== 0 ||
        body.available_amount !== 0
      ) {
        throw new Error("INTAKE_RESPONSE_INCOMPLETE_RETRY_SAME_IDEMPOTENCY_KEY");
      }
      setResult(body);
      setIdempotencyKey("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "INTAKE_FAILED");
    } finally {
      setBusy(false);
    }
  }

  if (authorization !== "allowed") {
    return (
      <main className="min-h-screen bg-background p-4 text-foreground md:p-8">
        <section role={authorization === "checking" ? "status" : "alert"} className="mx-auto max-w-xl rounded-lg border border-border p-6">
          <h1 className="text-lg font-semibold">B2B Corporate Debt Intake</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            {authorization === "checking"
              ? "Verifying administrator access…"
              : "Administrator access is required. No claim was submitted."}
          </p>
        </section>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-background p-4 text-foreground md:p-8">
      <div className="mx-auto max-w-3xl space-y-6">
        <header className="space-y-2">
          <p className="font-mono text-xs uppercase tracking-[0.2em] text-muted-foreground">Layer 1 · Evidence-first ingestion</p>
          <h1 className="text-2xl font-semibold">B2B Corporate Debt Intake</h1>
          <p className="text-sm text-muted-foreground">
            Submit one corporate invoice or contract with its source evidence. The record enters review; this form does not acquire the claim or authorize collection or payment.
          </p>
        </header>

        <div className="rounded-md border border-amber-500/50 bg-amber-500/5 p-4 text-sm">
          <strong>Recognition boundary:</strong> a successful submission records a claim for review. Recognized amount and available funds remain $0 until separately supported and authorized.
        </div>

        <form onSubmit={submit} className="space-y-5 rounded-lg border border-border p-4 md:p-6">
          <section className="grid gap-4 md:grid-cols-2">
            <label className="space-y-1 text-sm">
              <span className="block font-medium">Creditor EIN</span>
              <input required value={creditorEin} onChange={(e) => setCreditorEin(e.target.value)} placeholder="12-3456789" className="w-full rounded-md border border-input bg-background px-3 py-2" autoComplete="off" />
            </label>
            <label className="space-y-1 text-sm">
              <span className="block font-medium">Debtor EIN</span>
              <input required value={debtorEin} onChange={(e) => setDebtorEin(e.target.value)} placeholder="98-7654321" className="w-full rounded-md border border-input bg-background px-3 py-2" autoComplete="off" />
            </label>
            <label className="space-y-1 text-sm">
              <span className="block font-medium">Invoice face value (USD)</span>
              <input required type="number" min="0.01" step="0.01" value={faceValue} onChange={(e) => setFaceValue(e.target.value)} className="w-full rounded-md border border-input bg-background px-3 py-2" />
            </label>
            <label className="space-y-1 text-sm">
              <span className="block font-medium">Payment terms</span>
              <select value={terms} onChange={(e) => setTerms(e.target.value)} className="w-full rounded-md border border-input bg-background px-3 py-2">
                {["NET-0", "NET-15", "NET-30", "NET-45", "NET-60", "NET-90", "OTHER_DOCUMENTED"].map((value) => <option key={value} value={value}>{value}</option>)}
              </select>
            </label>
            <label className="space-y-1 text-sm">
              <span className="block font-medium">Maturity / due date</span>
              <input required type="date" value={maturity} onChange={(e) => setMaturity(e.target.value)} className="w-full rounded-md border border-input bg-background px-3 py-2" />
            </label>
            <label className="flex items-center gap-2 self-end pb-2 text-sm">
              <input type="checkbox" checked={assignmentClause} onChange={(e) => setAssignmentClause(e.target.checked)} />
              Assignment clause appears in source document
            </label>
          </section>

          <label className="block space-y-1 text-sm">
            <span className="block font-medium">Assignment-evidence reference</span>
            <input required value={assignmentRef} onChange={(e) => setAssignmentRef(e.target.value)} placeholder="Document section, clause, or evidence identifier" className="w-full rounded-md border border-input bg-background px-3 py-2" />
          </label>
          <label className="block space-y-1 text-sm">
            <span className="block font-medium">Source provenance</span>
            <textarea required rows={3} value={provenance} onChange={(e) => setProvenance(e.target.value)} placeholder="Where the document came from and how it was obtained" className="w-full rounded-md border border-input bg-background px-3 py-2" />
          </label>
          <label className="block space-y-1 text-sm">
            <span className="block font-medium">Original invoice or contract</span>
            <input key={fileInputKey} required type="file" accept={ACCEPT} onChange={(e) => setDocument(e.target.files?.[0] ?? null)} className="block w-full text-sm" />
            <span className="text-xs text-muted-foreground">PDF, image, text, DOC, or DOCX; maximum 15 MB.</span>
          </label>

          <div className="flex flex-wrap gap-3">
            <button disabled={busy || Boolean(result)} type="submit" className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50">
              {busy ? "Submitting and verifying…" : "Submit claim for review"}
            </button>
            <button disabled={busy} type="button" onClick={() => {
              setCreditorEin(""); setDebtorEin(""); setFaceValue(""); setTerms("NET-30"); setMaturity("");
              setAssignmentClause(false); setAssignmentRef(""); setProvenance(""); setDocument(null); setFileInputKey((key) => key + 1);
              setIdempotencyKey(""); setResult(null); setError("");
            }} className="rounded-md border border-border px-4 py-2 text-sm disabled:opacity-50">
              Clear form / start new claim
            </button>
          </div>
        </form>

        {error && <div role="alert" className="rounded-md border border-destructive/50 p-3 text-sm text-destructive">{error}</div>}
        {result && (
          <section className="space-y-3 rounded-lg border border-border p-4">
            <h2 className="font-semibold">Intake response</h2>
            <dl className="grid gap-3 text-sm md:grid-cols-2">
              <div><dt className="text-muted-foreground">Claim ID</dt><dd className="break-all font-mono">{result.claim_id ?? "—"}</dd></div>
              <div><dt className="text-muted-foreground">Document SHA-256</dt><dd className="break-all font-mono text-xs">{result.document_sha256 ?? "—"}</dd></div>
              <div><dt className="text-muted-foreground">Claim status</dt><dd>{result.claim_status ?? "—"}</dd></div>
              <div><dt className="text-muted-foreground">Review status</dt><dd>{result.review_status ?? "—"}</dd></div>
              <div><dt className="text-muted-foreground">Legal assignability</dt><dd>{result.legal_assignability ?? "UNVERIFIED"}</dd></div>
              <div><dt className="text-muted-foreground">Recognized / available</dt><dd>$0.00 / $0.00</dd></div>
            </dl>
            <p className="text-xs text-muted-foreground">Submission and file storage do not establish ownership, enforceability, collectibility, or settlement.</p>
          </section>
        )}
      </div>
    </main>
  );
}
