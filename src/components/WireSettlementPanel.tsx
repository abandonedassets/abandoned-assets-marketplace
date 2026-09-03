// Direct Bluevine wire settlement panel — zero processing fees, no BaaS API.
import { useEffect, useRef, useState } from "react";

type Instructions = {
  ok: boolean;
  amount_usd?: number;
  reference?: string;
  payout_status?: string | null;
  pdf_url?: string;
  error?: string;
  instructions?: {
    bank_name: string;
    bank_address: string;
    account_name: string;
    beneficiary_address: string | null;
    routing_number: string;
    account_number: string;
    rail: string;
  };
};

const money = (n: any) => `$${Math.round(Number(n) || 0).toLocaleString("en-US")}`;

export function WireSettlementPanel({ dealId }: { dealId: string }) {
  const [data, setData] = useState<Instructions | null>(null);
  const [sender, setSender] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetch(`/api/public/wire-instructions/${dealId}`)
      .then((r) => r.json())
      .then(setData)
      .catch((e) => setErr(String(e)));
  }, [dealId]);

  async function confirmWire() {
    setBusy(true);
    setErr(null);
    try {
      const fd = new FormData();
      fd.set("deal_id", dealId);
      fd.set("sender_name", sender);
      fd.set("reference", data?.reference ?? "");
      if (data?.amount_usd) fd.set("amount", String(data.amount_usd));
      const f = fileRef.current?.files?.[0];
      if (f) fd.set("receipt", f);
      const r = await fetch("/api/public/wire-confirm", { method: "POST", body: fd }).then((x) => x.json());
      if (!r?.ok) setErr(r?.error ?? "confirmation_failed");
      else setConfirmed(true);
    } catch (e) {
      setErr(String(e));
    } finally {
      setBusy(false);
    }
  }

  if (!data) return null;
  if (!data.ok || !data.instructions) {
    return (
      <section className="rounded-lg border bg-card p-4 font-mono text-[11px] text-muted-foreground">
        Wire instructions unavailable ({data.error ?? "unknown"}). Contact the settlement desk.
      </section>
    );
  }

  const i = data.instructions;
  const pending = confirmed || data.payout_status === "WIRE_PENDING_VERIFICATION";

  return (
    <section className="space-y-3 rounded-lg border bg-card p-4">
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="font-mono text-[11px] uppercase tracking-widest text-muted-foreground">
          wire transfer instructions · direct bank settlement
        </h2>
        <span className="font-mono text-sm font-semibold text-emerald-500">{money(data.amount_usd)}</span>
      </div>

      <dl className="grid gap-x-4 gap-y-2 font-mono text-[12px] sm:grid-cols-2">
        <Row k="Bank Name" v={i.bank_name} />
        <Row k="Rail" v={i.rail} />
        <Row k="Account Name" v={i.account_name} />
        <Row k="Bank Address" v={i.bank_address} />
        <Row k="Routing Number" v={i.routing_number} copy />
        <Row k="Account Number" v={i.account_number} copy />
        <Row k="Reference / Memo" v={data.reference ?? dealId} copy />
      </dl>

      <a
        href={data.pdf_url}
        target="_blank"
        rel="noreferrer"
        className="inline-block font-mono text-[11px] uppercase tracking-widest text-primary underline"
      >
        Download PDF instruction sheet
      </a>

      {pending ? (
        <div className="rounded border border-amber-500/40 bg-amber-500/10 p-3 font-mono text-[11px] text-amber-600">
          WIRE PENDING VERIFICATION — settlement desk notified. Funds confirm on receipt in Bluevine.
        </div>
      ) : (
        <div className="space-y-2 border-t pt-3">
          <input
            value={sender}
            onChange={(e) => setSender(e.target.value)}
            placeholder="Sending entity / account name"
            className="w-full rounded border bg-background px-3 py-2 text-sm"
          />
          <input
            ref={fileRef}
            type="file"
            accept="image/*,application/pdf"
            className="w-full text-[11px] file:mr-3 file:rounded file:border file:bg-muted file:px-2 file:py-1 file:text-[11px]"
          />
          {err && <p className="font-mono text-[11px] text-destructive">{err}</p>}
          <button
            disabled={busy}
            onClick={() => void confirmWire()}
            className="w-full rounded-lg bg-primary px-4 py-3 font-mono text-sm uppercase tracking-widest text-primary-foreground disabled:opacity-50"
          >
            {busy ? "submitting…" : "Confirm wire sent"}
          </button>
        </div>
      )}
    </section>
  );
}

function Row({ k, v, copy }: { k: string; v: string; copy?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-2 border-b border-dashed py-1">
      <dt className="text-[10px] uppercase tracking-widest text-muted-foreground">{k}</dt>
      <dd className="flex items-center gap-2 text-right font-semibold">
        {v}
        {copy && (
          <button
            onClick={() => void navigator.clipboard?.writeText(v)}
            className="rounded border px-1 text-[9px] uppercase text-muted-foreground"
          >
            copy
          </button>
        )}
      </dd>
    </div>
  );
}
