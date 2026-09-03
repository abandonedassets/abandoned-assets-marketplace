import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import {
  getSettlementReadiness,
  listTestCandidates,
  mintTestInvoice,
  checkSettlement,
} from "@/lib/settlement-test.functions";

export const Route = createFileRoute("/_authenticated/admin/settlement-test")({
  head: () => ({
    meta: [
      { title: "Settlement Test — Controlled ACH Invoice Drill" },
      {
        name: "description",
        content:
          "Run a small-dollar Bluevine ACH debit against a live deal and verify the settlement webhook flips the row to FUNDS-CLEARED.",
      },
      { property: "og:title", content: "Settlement Test — Controlled ACH Invoice Drill" },
      {
        property: "og:description",
        content:
          "Mint a low-fee ACH invoice and watch the webhook write cleared_at to the pipeline row.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: SettlementTest,
  errorComponent: ({ error, reset }) => {
    const router = useRouter();
    return (
      <div className="p-6 font-mono text-sm">
        <p className="text-destructive">Drill offline: {(error as Error).message}</p>
        <button
          className="mt-2 underline"
          onClick={() => {
            reset();
            router.invalidate();
          }}
        >
          Retry
        </button>
      </div>
    );
  },
});

const usd = (n: unknown) =>
  Number(n ?? 0).toLocaleString("en-US", { style: "currency", currency: "USD" });

function Dot({ ok }: { ok: boolean }) {
  return (
    <span className={ok ? "text-emerald-500" : "text-destructive"}>
      {ok ? "●" : "○"}
    </span>
  );
}

function SettlementTest() {
  const readiness = useServerFn(getSettlementReadiness);
  const candidates = useServerFn(listTestCandidates);
  const mint = useServerFn(mintTestInvoice);
  const check = useServerFn(checkSettlement);

  const [dealId, setDealId] = useState("");
  const [email, setEmail] = useState("");
  const [invoice, setInvoice] = useState<Record<string, any> | null>(null);
  const [minting, setMinting] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [watching, setWatching] = useState(false);
  const [row, setRow] = useState<Record<string, any> | null>(null);

  const env = useQuery({ queryKey: ["settlement-readiness"], queryFn: () => readiness() });
  const list = useQuery({ queryKey: ["settlement-candidates"], queryFn: () => candidates() });

  useEffect(() => {
    if (!watching || !dealId) return;
    let alive = true;
    const tick = async () => {
      try {
        const r = await check({ data: { dealId } });
        if (!alive) return;
        setRow(r.row);
        if (r.row?.cleared_at) setWatching(false);
      } catch {
        /* fail-forward: keep polling */
      }
    };
    void tick();
    const t = setInterval(tick, 5000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [watching, dealId, check]);

  const cleared = Boolean(row?.cleared_at);

  const doMint = async () => {
    setErr(null);
    setInvoice(null);
    setMinting(true);
    try {
      const r: any = await mint({ data: { dealId: dealId.trim(), email } });
      if (r?.ok) {
        setInvoice(r);
        setWatching(true);
      } else {
        setErr(`${r?.error ?? "failed"}${r?.detail ? ` — ${r.detail}` : ""}`);
      }
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setMinting(false);
    }
  };

  const e = env.data;

  return (
    <div className="min-h-screen bg-background p-4 font-mono text-sm md:p-8">
      <header className="mb-6">
        <h1 className="text-lg font-bold tracking-tight">
          CONTROLLED SETTLEMENT DRILL
        </h1>
        <p className="text-muted-foreground">
          Small-dollar Bluevine ACH debit → settlement webhook → FUNDS-CLEARED on the row.
        </p>
      </header>

      {/* STEP 0 — preflight */}
      <section className="mb-6 rounded-md border border-border p-4">
        <h2 className="mb-3 font-bold">STEP 0 · PREFLIGHT</h2>
        {env.isLoading || !e ? (
          <p className="text-muted-foreground">checking…</p>
        ) : (
          <ul className="grid gap-1 md:grid-cols-2">
            <li><Dot ok={e.stripe_restricted_key} /> STRIPE_RESTRICTED_KEY</li>

          </ul>
        )}
        <p className="mt-3 text-xs text-muted-foreground">
          Webhook endpoint to register with Bluevine:{" "}
          <code>/api/public/hooks/bluevine-settlement</code> — subscribed to{" "}
          <code>ach.debit.settled</code> and <code>wire.credit.received</code>.
        </p>
      </section>

      {/* STEP 1 — pick deal */}
      <section className="mb-6 rounded-md border border-border p-4">
        <h2 className="mb-3 font-bold">STEP 1 · PICK THE LOWEST-FEE UNCLEARED DEAL</h2>
        {list.isLoading ? (
          <p className="text-muted-foreground">loading tape…</p>
        ) : !list.data?.rows.length ? (
          <p className="text-muted-foreground">No uncleared deals with a fee.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="text-muted-foreground">
                <tr className="border-b border-border">
                  <th className="p-2 text-left">FEE</th>
                  <th className="p-2 text-left">ADDRESS</th>
                  <th className="p-2 text-left">STATUS</th>
                  <th className="p-2 text-left">STRIPE</th>
                  <th className="p-2" />
                </tr>
              </thead>
              <tbody>
                {list.data.rows.map((r) => (
                  <tr
                    key={r.id}
                    className={`border-b border-border/50 ${dealId === r.id ? "bg-muted" : ""}`}
                  >
                    <td className="p-2 font-bold">{usd(r.optimized_acquisition_premium)}</td>
                    <td className="p-2">
                      {r.address ?? "—"}{" "}
                      <span className="text-muted-foreground">{r.zip ?? ""}</span>
                    </td>
                    <td className="p-2">{r.status}</td>
                    <td className="p-2">{r.verification_status ?? "UNVERIFIED"}</td>
                    <td className="p-2 text-right">
                      <button
                        className="underline"
                        onClick={() => {
                          setDealId(r.id);
                          setInvoice(null);
                          setRow(null);
                          setWatching(false);
                        }}
                      >
                        select
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <input
          className="mt-3 w-full rounded border border-border bg-transparent p-2"
          placeholder="deal id"
          value={dealId}
          onChange={(ev) => setDealId(ev.target.value)}
        />
      </section>

      {/* STEP 2 — mint invoice */}
      <section className="mb-6 rounded-md border border-border p-4">
        <h2 className="mb-3 font-bold">STEP 2 · MINT ACH-ONLY INVOICE</h2>
        <input
          className="mb-3 w-full rounded border border-border bg-transparent p-2"
          placeholder="buyer email (optional — receives the invoice)"
          value={email}
          onChange={(ev) => setEmail(ev.target.value)}
        />
        <button
          disabled={!dealId.trim() || minting}
          onClick={doMint}
          className="rounded bg-primary px-4 py-2 font-bold text-primary-foreground disabled:opacity-40"
        >
          {minting ? "MINTING…" : "▸ MINT TEST INVOICE"}
        </button>
        {err && <p className="mt-3 text-destructive">ERR: {err}</p>}
        {invoice && (
          <div className="mt-3">
            <p className="text-emerald-500">
              {invoice.reused ? "REUSED" : "CREATED"} {invoice.invoice_id}
            </p>
            <a
              className="underline"
              href={invoice.url}
              target="_blank"
              rel="noreferrer"
            >
              Open hosted invoice → pay with a bank account
            </a>
            <p className="mt-1 text-xs text-muted-foreground">
              Cards are rejected by design — payment_method_types is locked to
              us_bank_account.
            </p>
          </div>
        )}
      </section>

      {/* STEP 3 — watch webhook */}
      <section className="rounded-md border border-border p-4">
        <h2 className="mb-3 font-bold">STEP 3 · WATCH THE WEBHOOK WRITE</h2>
        <div className="flex items-center gap-3">
          <button
            disabled={!dealId.trim()}
            onClick={() => setWatching((w) => !w)}
            className="rounded border border-border px-3 py-1 disabled:opacity-40"
          >
            {watching ? "◼ STOP POLLING" : "▸ POLL EVERY 5s"}
          </button>
          {watching && <span className="text-muted-foreground">listening…</span>}
        </div>

        <div
          className={`mt-4 rounded border p-4 ${
            cleared ? "border-emerald-600 bg-emerald-950/20" : "border-border"
          }`}
        >
          {!row ? (
            <p className="text-muted-foreground">No reading yet.</p>
          ) : (
            <ul className="grid gap-1">
              <li>
                STATUS:{" "}
                <span className={cleared ? "font-bold text-emerald-500" : ""}>
                  {cleared ? "FUNDS-CLEARED" : row.status}
                </span>
              </li>
              <li>ESCROW: {row.escrow_status ?? "—"}</li>
              <li>
                CLEARED_AT:{" "}
                {row.cleared_at ? new Date(row.cleared_at).toLocaleString() : "—"}
              </li>
              <li>
                CLEARED_AMOUNT: {row.cleared_at ? usd(row.cleared_amount) : "—"}
              </li>
              <li>BLUEVINE: {row.verification_status ?? "UNVERIFIED"}</li>
            </ul>
          )}
        </div>

        <p className="mt-3 text-xs text-muted-foreground">
          If the debit settled but this stays UNVERIFIED, the webhook endpoint
          or its signing secret is misconfigured at Bluevine — nothing in the
          database is guessed client-side.
        </p>
      </section>
    </div>
  );
}
