import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState, useCallback } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  getPlaidStatus,
  createPlaidLinkToken,
  exchangePlaidPublicToken,
  unlinkPlaidAccount,
  listPlaidTransfers,
} from "@/lib/plaid.functions";
import { getRailDiagnostics } from "@/lib/banking.functions";
import { BeneficiaryLiability } from "@/components/admin/BeneficiaryLiability";
import { RecipientSplitRouting } from "@/components/admin/RecipientSplitRouting";
import { GatewayConnector } from "@/components/admin/GatewayConnector";
import { InboundListenerDiagnostics } from "@/components/admin/InboundListenerDiagnostics";


export const Route = createFileRoute("/_authenticated/admin/banking")({
  head: () => ({
    meta: [
      { title: "Settlement Rail — Bluevine ACH Link" },
      {
        name: "description",
        content:
          "Link the Bluevine Business Checking account through Plaid and monitor automated ACH settlement transfers.",
      },
      { property: "og:title", content: "Settlement Rail — Bluevine ACH Link" },
      {
        property: "og:description",
        content: "Plaid token exchange and ACH settlement monitoring for the Bluevine rail.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: BankingPage,
});

function loadPlaidScript(): Promise<any> {
  return new Promise((resolve, reject) => {
    const w = window as any;
    if (w.Plaid) return resolve(w.Plaid);
    const s = document.createElement("script");
    s.src = "https://cdn.plaid.com/link/v2/stable/link-initialize.js";
    s.onload = () => resolve((window as any).Plaid);
    s.onerror = () => reject(new Error("plaid_script_failed"));
    document.head.appendChild(s);
  });
}

function BankingPage() {
  const qc = useQueryClient();
  const status = useServerFn(getPlaidStatus);
  const mintToken = useServerFn(createPlaidLinkToken);
  const exchange = useServerFn(exchangePlaidPublicToken);
  const unlink = useServerFn(unlinkPlaidAccount);
  const transfers = useServerFn(listPlaidTransfers);

  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const s = useQuery({ queryKey: ["plaid-status"], queryFn: () => status() });
  const t = useQuery({ queryKey: ["plaid-transfers"], queryFn: () => transfers() });

  useEffect(() => {
    loadPlaidScript().catch(() => {});
  }, []);

  const startLink = useCallback(async () => {
    setBusy(true);
    setMsg(null);
    try {
      const res: any = await mintToken();
      if (!res?.ok) {
        setMsg(`Link token failed: ${res?.detail ?? res?.error ?? "unknown"}`);
        return;
      }
      const Plaid = await loadPlaidScript();
      const handler = Plaid.create({
        token: res.link_token,
        onSuccess: async (public_token: string, metadata: any) => {
          const out: any = await exchange({
            data: {
              publicToken: public_token,
              accountId: metadata?.accounts?.[0]?.id ?? null,
            },
          });
          setMsg(
            out?.ok
              ? `Linked ${out.account_name ?? "Bluevine"} ••••${out.account_mask ?? "----"}`
              : `Exchange failed: ${out?.detail ?? out?.error}`,
          );
          qc.invalidateQueries({ queryKey: ["plaid-status"] });
        },
        onExit: (err: any) => {
          if (err) setMsg(`Link exited: ${err.error_message ?? err.error_code}`);
        },
      });
      handler.open();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, [mintToken, exchange, qc]);

  const d: any = s.data ?? {};

  return (
    <main className="mx-auto w-full max-w-4xl space-y-6 p-6">
      <header>
        <h1 className="text-2xl font-bold tracking-tight">Settlement Rail — Bluevine ACH</h1>
        <p className="text-muted-foreground text-sm">
          Plaid-certified aggregator link (institution {d.institution_id ?? "ins_127296"}). Access
          tokens are stored in serverless secrets storage and never exposed to the browser.
        </p>
      </header>

      <section className="border-border bg-card rounded-lg border p-5">
        <div className="grid grid-cols-2 gap-4 text-sm md:grid-cols-4">
          <Stat label="Credentials" value={d.credentials_ready ? "READY" : "MISSING"} />
          <Stat label="Link status" value={d.linked ? "LINKED" : "NOT LINKED"} />
          <Stat label="Account" value={d.account_mask ? `••••${d.account_mask}` : "—"} />
          <Stat label="Environment" value={String(d.env ?? "—").toUpperCase()} />
        </div>

        <div className="mt-5 flex flex-wrap gap-3">
          <button
            onClick={startLink}
            disabled={busy}
            className="bg-primary text-primary-foreground rounded-md px-4 py-2 text-sm font-semibold disabled:opacity-50"
          >
            {d.linked ? "Re-link Bluevine Account" : "Link Bluevine Business Checking"}
          </button>
          {d.linked ? (
            <button
              onClick={async () => {
                await unlink();
                qc.invalidateQueries({ queryKey: ["plaid-status"] });
              }}
              className="border-border rounded-md border px-4 py-2 text-sm"
            >
              Unlink
            </button>
          ) : null}
        </div>
        {msg ? <p className="text-muted-foreground mt-3 text-xs">{msg}</p> : null}
      </section>

      <GatewayConnector />

      <RailDiagnostics />

      <InboundListenerDiagnostics />

      <BeneficiaryLiability />

      <RecipientSplitRouting />


      <section className="border-border bg-card rounded-lg border p-5">
        <h2 className="mb-3 text-sm font-semibold tracking-wide uppercase">Recent ACH Transfers</h2>
        {(t.data ?? []).length === 0 ? (
          <p className="text-muted-foreground text-sm">No transfers executed on this rail yet.</p>
        ) : (
          <div className="space-y-2">
            {(t.data as any[]).map((r) => (
              <div key={r.id} className="flex items-center justify-between text-sm">
                <span className="font-mono text-xs">{r.transfer_id}</span>
                <span className="uppercase">{r.direction}</span>
                <span>${Number(r.amount_usd).toLocaleString("en-US")}</span>
                <span className="text-muted-foreground">{r.status}</span>
              </div>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}

function RailDiagnostics() {
  const diag = useServerFn(getRailDiagnostics);
  const q = useQuery({
    queryKey: ["rail-diagnostics"],
    queryFn: () => diag(),
    refetchInterval: 60_000,
  });
  const d: any = q.data;
  if (!d) return null;
  const live = Boolean(d.live_transfer_ready);

  return (
    <section className="border-border bg-card rounded-lg border p-5">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-sm font-semibold tracking-wide uppercase">
          Live Production Readiness
        </h2>
        <span
          className={`rounded-full px-3 py-1 text-[11px] font-bold tracking-wide uppercase ${
            live ? "bg-emerald-500/15 text-emerald-500" : "bg-amber-500/15 text-amber-500"
          }`}
        >
          {live ? "● LIVE FUND TRANSFER READY" : `● ${String(d.mode).replace(/_/g, " ")}`}
        </span>
      </div>

      <div className="grid grid-cols-2 gap-4 text-sm md:grid-cols-4">
        <Stat label="Plaid env" value={String(d.rails?.plaid_env ?? "—").toUpperCase()} />
        <Stat label="Plaid credentials" value={d.rails?.plaid_credentials ? "LIVE" : "MISSING"} />
        <Stat label="Bluevine coords" value={d.bluevine?.coordinates_ready ? "BOUND" : "MISSING"} />
        <Stat
          label="Bank REST facility"
          value={d.bluevine?.rest_facility_bound ? "BOUND" : "INSTRUCTION"}
        />
        <Stat
          label="Settlement webhook"
          value={d.webhooks?.bluevine_settlement_secret ? "SIGNED" : "UNBOUND"}
        />
        <Stat label="M2M signing" value={d.webhooks?.m2m_signing_secret ? "ACTIVE" : "OFF"} />
        <Stat label="Account link" value={d.plaid?.linked ? "LINKED" : "NOT LINKED"} />
        <Stat label="Checked" value={new Date(d.checked_at).toLocaleTimeString()} />
      </div>

      {d.rails?.reason ? (
        <p className="text-muted-foreground mt-3 text-xs">Blocker: {d.rails.reason}</p>
      ) : null}

      <h3 className="mt-6 mb-2 text-[11px] font-semibold tracking-wide uppercase">
        Beneficiary Routing Matrix
      </h3>
      <div className="space-y-2">
        {(d.beneficiaries ?? []).map((b: any) => (
          <div key={b.key} className="flex items-center justify-between text-sm">
            <span className="font-medium">{b.name}</span>
            <span className="text-muted-foreground font-mono text-xs">
              {b.account_last4 ? `••••${b.account_last4}` : "no coordinates"}
            </span>
            <span
              className={b.configured ? "text-emerald-500 text-xs" : "text-amber-500 text-xs"}
            >
              {b.configured ? "READY" : "UNCONFIGURED"}
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-muted-foreground text-[10px] tracking-wide uppercase">{label}</div>
      <div className="font-semibold">{value}</div>
    </div>
  );
}
