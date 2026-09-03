import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { getRecipientProfiles, saveRecipientProfile } from "@/lib/banking.functions";

const usd = (n: number) =>
  `$${(Number(n) || 0).toLocaleString("en-US", { maximumFractionDigits: 2 })}`;

type Form = {
  recipient_key: string;
  display_name: string;
  bank_name: string;
  routing_number: string;
  account_number: string;
  allocation_pct: string;
  flat_amount_usd: string;
};

const EMPTY: Form = {
  recipient_key: "JACQUITA",
  display_name: "",
  bank_name: "",
  routing_number: "",
  account_number: "",
  allocation_pct: "",
  flat_amount_usd: "",
};

export function RecipientSplitRouting() {
  const load = useServerFn(getRecipientProfiles);
  const save = useServerFn(saveRecipientProfile);
  const [form, setForm] = useState<Form>(EMPTY);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [reveal, setReveal] = useState(false);

  const q = useQuery({
    queryKey: ["recipient-profiles"],
    queryFn: () => load(),
    refetchInterval: 120_000,
    retry: false,
  });
  const d: any = q.data;
  if (q.isError) return null;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    try {
      const r: any = await save({
        data: {
          recipient_key: form.recipient_key,
          display_name: form.display_name,
          bank_name: form.bank_name,
          routing_number: form.routing_number,
          account_number: form.account_number,
          allocation_pct: Number(form.allocation_pct || 0),
          flat_amount_usd: Number(form.flat_amount_usd || 0),
        },
      });
      setMsg(r?.ok ? "Recipient routing saved." : `Failed: ${r?.error ?? "unknown"}`);
      if (r?.ok) {
        setForm({ ...EMPTY, recipient_key: form.recipient_key });
        q.refetch();
      }
    } catch {
      setMsg("Failed: request error");
    } finally {
      setBusy(false);
    }
  };

  const input =
    "border-border bg-background w-full rounded-md border px-3 py-2 text-sm outline-none";

  return (
    <section className="border-border bg-card rounded-lg border p-5">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-sm font-semibold tracking-wide uppercase">
          Split Payout Routing
        </h2>
        <span className="bg-primary/10 text-primary rounded-full px-3 py-1 text-[11px] font-bold tracking-wide uppercase">
          Multi-recipient
        </span>
      </div>

      <p className="text-muted-foreground mb-4 text-xs">
        Cleared assignment fees are split at settlement: each configured recipient receives an
        ACH/Fedwire leg to their own routing and account number, and the remainder wires to the
        primary Bluevine account.
      </p>

      <div className="border-border bg-muted/30 mb-5 rounded-md border p-4">
        <div className="text-muted-foreground mb-2 text-[10px] font-bold tracking-wide uppercase">
          Automated routing mandate (locked, evaluated top-down)
        </div>
        <ol className="text-muted-foreground space-y-1 font-mono text-[11px]">
          <li>1 · ROUTE_MUNCIE_JAQUIDA — any Muncie, IN asset → 100% Jaquita</li>
          <li>2 · ROUTE_TIMBER_JASMINE — timber land outside Muncie → 100% Jazmin</li>
          <li>3 · MASTER_SYSTEM_100K_PLUS — value ≥ $100,000 → 100% master system</li>
          <li>4 · SUB_100K_PARITY — under $100k: EVEN parcel → master, ODD parcel → Jazmin</li>
        </ol>
        <p className="text-muted-foreground mt-2 text-[11px]">
          Bank coordinates below only supply the wire destination — the mandate above decides the
          amounts. Every settlement records its decision code to the audit log.
        </p>
      </div>

      <div className="mb-5 grid grid-cols-1 gap-3 sm:grid-cols-2">
        {(d?.profiles ?? []).map((p: any) => (
          <div key={p.recipient_key} className="border-border rounded-md border p-4">
            <div className="flex items-center justify-between">
              <span className="text-sm font-semibold">{p.display_name}</span>
              <span
                className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ${
                  p.configured
                    ? "bg-emerald-500/10 text-emerald-500"
                    : "bg-muted text-muted-foreground"
                }`}
              >
                {p.configured ? "Direct wire" : "Accrue only"}
              </span>
            </div>
            <div className="text-muted-foreground mt-2 font-mono text-[11px]">
              {p.routing_prefix ? `${p.routing_prefix}•••••• / ••••${p.account_last4}` : "no coordinates"}
            </div>
            <div className="mt-2 text-xs">
              {p.flat_amount_usd > 0
                ? `${usd(p.flat_amount_usd)} flat per settlement`
                : `${p.allocation_pct}% of net fee`}
              {p.is_active ? "" : " · inactive"}
            </div>
          </div>
        ))}
      </div>

      <form onSubmit={submit} className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <select
          className={input}
          value={form.recipient_key}
          onChange={(e) => setForm({ ...form, recipient_key: e.target.value })}
        >
          <option value="JACQUITA">Jaquita</option>
          <option value="DAUGHTER">Jazmin</option>
        </select>
        <input
          className={input}
          placeholder="Display name (optional)"
          value={form.display_name}
          onChange={(e) => setForm({ ...form, display_name: e.target.value })}
        />
        <input
          className={input}
          placeholder="Bank name"
          value={form.bank_name}
          onChange={(e) => setForm({ ...form, bank_name: e.target.value })}
        />
        <div className="relative">
          <input
            className={input + " pr-16"}
            type={reveal ? "text" : "password"}
            autoComplete="off"
            placeholder="Routing number (9 digits)"
            inputMode="numeric"
            value={form.routing_number}
            onChange={(e) => setForm({ ...form, routing_number: e.target.value })}
          />
          <button
            type="button"
            onClick={() => setReveal((v) => !v)}
            className="text-muted-foreground absolute top-1/2 right-2 -translate-y-1/2 text-[10px] font-bold tracking-wide uppercase"
          >
            {reveal ? "Hide" : "Show"}
          </button>
        </div>
        <input
          className={input}
          type={reveal ? "text" : "password"}
          autoComplete="off"
          placeholder="Account number"
          inputMode="numeric"
          value={form.account_number}
          onChange={(e) => setForm({ ...form, account_number: e.target.value })}
        />
        <input
          className={input}
          placeholder="Allocation % of net fee"
          inputMode="decimal"
          value={form.allocation_pct}
          onChange={(e) => setForm({ ...form, allocation_pct: e.target.value })}
        />
        <input
          className={input}
          placeholder="Or flat $ per settlement"
          inputMode="decimal"
          value={form.flat_amount_usd}
          onChange={(e) => setForm({ ...form, flat_amount_usd: e.target.value })}
        />
        <button
          type="submit"
          disabled={busy}
          className="bg-primary text-primary-foreground rounded-md px-4 py-2 text-sm font-semibold disabled:opacity-50"
        >
          {busy ? "Saving…" : "Save recipient routing"}
        </button>
      </form>

      {msg && <p className="text-muted-foreground mt-3 text-xs">{msg}</p>}
      {d && (
        <div className="border-border mt-4 flex items-center justify-between border-t pt-3 text-sm">
          <span className="text-muted-foreground">Total allocated to recipients</span>
          <span className="font-mono font-semibold">{d.total_allocated_pct}%</span>
        </div>
      )}
    </section>
  );
}
