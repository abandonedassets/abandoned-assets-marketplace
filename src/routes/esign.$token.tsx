// Public buyer-facing inline execution portal — no PDF friction.
import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";

export const Route = createFileRoute("/esign/$token")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Execute Assignment Agreement | ReelEdge" },
      {
        name: "description",
        content:
          "Secure inline execution of an assignment agreement with ACH settlement instructions.",
      },
      { property: "og:title", content: "Execute Assignment Agreement | ReelEdge" },
      {
        property: "og:description",
        content: "Sign the assignment agreement and receive ACH settlement instructions.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: EsignPortal,
});

const money = (n: any) => `$${Math.round(Number(n) || 0).toLocaleString("en-US")}`;

function fingerprint(): string {
  try {
    const n = navigator as any;
    const parts = [
      n.userAgent,
      n.language,
      n.hardwareConcurrency,
      n.platform,
      screen.width + "x" + screen.height + "@" + window.devicePixelRatio,
      Intl.DateTimeFormat().resolvedOptions().timeZone,
    ].join("|");
    let h = 0;
    for (let i = 0; i < parts.length; i++) h = (h * 31 + parts.charCodeAt(i)) | 0;
    return `fp_${(h >>> 0).toString(16)}_${parts.length}`;
  } catch {
    return "fp_unavailable";
  }
}

function EsignPortal() {
  const { token } = Route.useParams();
  const [data, setData] = useState<any>(null);
  const [name, setName] = useState("");
  const [entity, setEntity] = useState("");
  const [w9Name, setW9Name] = useState("");
  const [w9Class, setW9Class] = useState("LLC");
  const [w9Tin, setW9Tin] = useState("");

  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [blocked, setBlocked] = useState(false);
  const [invoice, setInvoice] = useState<string | null>(null);
  const [pof, setPof] = useState<any>(null);
  const [pofBusy, setPofBusy] = useState(false);

  const loadPof = () =>
    fetch(`/api/public/esign/${token}/pof`)
      .then((r) => r.json())
      .then((d) => setPof(d?.error ? null : d))
      .catch(() => {});

  useEffect(() => {
    loadPof();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  function loadPlaid(): Promise<any> {
    const w = window as any;
    if (w.Plaid) return Promise.resolve(w.Plaid);
    return new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = "https://cdn.plaid.com/link/v2/stable/link-initialize.js";
      s.onload = () => resolve((window as any).Plaid);
      s.onerror = () => reject(new Error("plaid_script_failed"));
      document.head.appendChild(s);
    });
  }

  async function startPof() {
    setPofBusy(true);
    setErr(null);
    try {
      const res = await fetch(`/api/public/esign/${token}/pof`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "link" }),
      });
      const j = await res.json();
      if (!j?.ok) throw new Error(j?.detail ?? j?.error ?? "link_failed");
      const Plaid = await loadPlaid();
      const handler = Plaid.create({
        token: j.link_token,
        onSuccess: async (public_token: string) => {
          await fetch(`/api/public/esign/${token}/pof`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: "verify", public_token }),
          });
          await loadPof();
          setPofBusy(false);
        },
        onExit: () => setPofBusy(false),
      });
      handler.open();
    } catch (e: any) {
      setErr("Bank verification unavailable. " + (e?.message ?? ""));
      setPofBusy(false);
    }
  }

  useEffect(() => {
    fetch(`/api/public/esign/${token}`)
      .then((r) => r.json())
      .then((d) => {
        setData(d);
        if (d?.invoice_url) setInvoice(d.invoice_url);
        if (d?.status === "Blocked-OFAC") setBlocked(true);
      })
      .catch(() => setErr("Unable to load agreement."));
  }, [token]);

  async function sign() {
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch(`/api/public/esign/${token}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          signerName: name,
          buyerEntity: entity,
          w9LegalName: w9Name,
          w9TaxClassification: w9Class,
          w9Tin,
          deviceFingerprint: fingerprint(),
        }),
      });
      const j = await res.json();
      if (j?.ok && j.invoice_url) setInvoice(j.invoice_url);
      else if (j?.error === "compliance_hold") {
        setBlocked(true);
        setErr("Execution locked pending compliance review.");
      } else if (j?.error === "pof_required") {
        await loadPof();
        setErr("Bank-verified proof of funds is required before execution.");
      } else if (j?.error === "w9_required") {
        setErr("A complete W-9 (legal name, tax classification, 9-digit TIN/EIN) is required.");
      } else setErr(j?.error ?? "Execution failed.");

    } catch {
      setErr("Execution failed.");
    } finally {
      setBusy(false);
    }
  }

  if (err && !data) return <Shell><p className="text-destructive">{err}</p></Shell>;
  if (!data) return <Shell><p className="text-muted-foreground">Loading agreement…</p></Shell>;
  if (data.error) return <Shell><p className="text-destructive">Agreement not found or expired.</p></Shell>;

  const p = data.closing_pipeline_items ?? {};

  return (
    <Shell>
      <h1 className="text-2xl font-semibold mb-1">Assignment Agreement</h1>
      <p className="text-sm text-muted-foreground mb-6">
        Inline execution — no printing, no scanning.
      </p>

      <dl className="grid grid-cols-2 gap-x-4 gap-y-2 font-mono text-sm mb-6">
        <dt className="text-muted-foreground">Address</dt>
        <dd>{[p.address, p.city, p.state, p.zip].filter(Boolean).join(", ") || "—"}</dd>
        <dt className="text-muted-foreground">APN</dt>
        <dd>{p.apn ?? "—"}</dd>
        <dt className="text-muted-foreground">Contract Price</dt>
        <dd>{money(p.base_contract_price)}</dd>
        <dt className="text-muted-foreground">Assignment Fee</dt>
        <dd>{money(data.assignment_fee)}</dd>
        <dt className="text-muted-foreground">Buyer</dt>
        <dd>{data.buyer_email}</dd>
      </dl>

      <ul className="text-xs text-muted-foreground space-y-1 mb-6 list-disc pl-5">
        <li>Anti-Circumvention: $25,000 liquidated damages.</li>
        <li>Hardened 24-Hour EMD Lock from execution.</li>
        <li>Inspection Waiver — asset accepted as-is.</li>
        <li>Settlement by ACH (us_bank_account) only.</li>
        <li>
          Seller's sole and exclusive remedy on assignor default is retention of the Earnest Money
          Deposit; specific performance is expressly waived.
        </li>
        <li>
          Equitable interest attaches on execution; a Memorandum of Contract is recorded against the
          property.
        </li>
        <li>
          Counterparty entity and signatory are screened against the OFAC SDN list at execution.
        </li>
        <li>
          IP address, device fingerprint, user-agent, and timestamp are captured as conclusive proof
          of authorization for the assignment and the ACH debit (E-SIGN / UETA).
        </li>
      </ul>

      {blocked ? (
        <div className="rounded-md border border-destructive/50 bg-destructive/5 p-4">
          <p className="font-medium text-destructive">Execution locked — compliance review.</p>
          <p className="text-sm text-muted-foreground mt-1">
            This transaction cannot proceed. Our compliance desk has been notified.
          </p>
        </div>
      ) : invoice ? (
        <div className="rounded-md border border-primary/40 bg-primary/5 p-4">
          <p className="font-medium mb-2">Executed. ACH invoice issued.</p>
          <a
            className="inline-block rounded-md bg-primary px-4 py-2 text-primary-foreground"
            href={invoice}
          >
            Pay via ACH
          </a>
        </div>
      ) : (
        <div className="space-y-3">
          {pof?.enabled && pof.status !== "passed" && (
            <div className="rounded-md border border-amber-500/50 bg-amber-500/5 p-4 space-y-2">
              <p className="font-medium">Proof of Funds required</p>
              <p className="text-xs text-muted-foreground">
                Connect your bank to instantly verify {money(pof.required_usd)} in liquid funds.
                Read-only balance check — no charge, no credentials stored.
              </p>
              {pof.status === "failed" && (
                <p className="text-sm text-destructive">
                  Verified balance {money(pof.available_usd ?? 0)} is below the required{" "}
                  {money(pof.required_usd)}. Execution is locked.
                </p>
              )}
              <button
                disabled={pofBusy}
                onClick={startPof}
                className="rounded-md bg-primary px-4 py-2 text-primary-foreground disabled:opacity-50"
              >
                {pofBusy ? "Verifying…" : "Verify funds with my bank"}
              </button>
            </div>
          )}
          {pof?.enabled && pof.status === "passed" && (
            <p className="text-sm text-emerald-500">
              ✓ Proof of Funds verified — {money(pof.available_usd ?? 0)} liquid.
            </p>
          )}
          <label className="block text-sm">
            Acquiring entity (exact legal name)
            <input
              className="mt-1 w-full rounded-md border bg-background px-3 py-2"
              value={entity}
              maxLength={200}
              onChange={(e) => setEntity(e.target.value)}
              placeholder="Acme Capital Partners LLC"
            />
          </label>
          <label className="block text-sm">
            Type your full legal name to execute
            <input
              className="mt-1 w-full rounded-md border bg-background px-3 py-2"
              value={name}
              maxLength={120}
              onChange={(e) => setName(e.target.value)}
              placeholder="Jane Q. Buyer"
            />
          </label>
          <fieldset className="rounded-md border p-3 space-y-3">
            <legend className="px-1 text-xs uppercase tracking-wide text-muted-foreground">
              IRS Form W-9 — Substitute Certification (required)
            </legend>
            <label className="block text-sm">
              Legal name as shown on the tax return
              <input
                className="mt-1 w-full rounded-md border bg-background px-3 py-2"
                value={w9Name}
                maxLength={200}
                onChange={(e) => setW9Name(e.target.value)}
                placeholder="Acme Capital Partners LLC"
              />
            </label>
            <label className="block text-sm">
              Federal tax classification
              <select
                className="mt-1 w-full rounded-md border bg-background px-3 py-2"
                value={w9Class}
                onChange={(e) => setW9Class(e.target.value)}
              >
                <option value="LLC">Limited Liability Company</option>
                <option value="C-Corp">C Corporation</option>
                <option value="S-Corp">S Corporation</option>
                <option value="Partnership">Partnership</option>
                <option value="Trust/Estate">Trust / Estate</option>
                <option value="Individual/Sole-Prop">Individual / Sole Proprietor</option>
              </select>
            </label>
            <label className="block text-sm">
              TIN / EIN (9 digits)
              <input
                className="mt-1 w-full rounded-md border bg-background px-3 py-2"
                value={w9Tin}
                inputMode="numeric"
                maxLength={11}
                onChange={(e) => setW9Tin(e.target.value)}
                placeholder="12-3456789"
              />
            </label>
            <p className="text-xs text-muted-foreground">
              By executing you certify under penalties of perjury that this TIN is correct, that you
              are not subject to backup withholding, and that you are a U.S. person. Only the last
              four digits are retained; the full TIN is stored as a one-way hash.
            </p>
          </fieldset>
          <button
            disabled={
              busy ||
              name.trim().length < 2 ||
              entity.trim().length < 2 ||
              w9Name.trim().length < 2 ||
              w9Tin.replace(/\D/g, "").length !== 9 ||
              Boolean(pof?.enabled && pof.status !== "passed")
            }
            onClick={sign}
            className="rounded-md bg-primary px-5 py-2 text-primary-foreground disabled:opacity-50"
          >
            {busy ? "Screening & executing…" : "Certify W-9 & Execute Agreement"}
          </button>

          {err && <p className="text-sm text-destructive">{err}</p>}
        </div>
      )}

    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="mx-auto max-w-2xl px-6 py-12">
      <div className="rounded-lg border bg-card p-6 text-card-foreground">{children}</div>
    </main>
  );
}
