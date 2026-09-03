import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { listPipelineItems } from "@/lib/pipeline.functions";
import { TriPartySweepLedger } from "@/components/admin/money/TriPartySweepLedger";

export const Route = createFileRoute("/_authenticated/admin/treasury")({
  head: () => ({
    meta: [
      { title: "Treasury & Entity Structure — Capital Stack" },
      { name: "robots", content: "noindex,nofollow" },
    ],
  }),
  component: Treasury,
});

const BALANCE_SHEET_ASSETS = 222_597_376;
const SETTLED = ["Funds-Cleared", "Closed"];
const usd = (n: number) =>
  `$${Math.round(n).toLocaleString("en-US")}`;

function Treasury() {
  const fetchPipeline = useServerFn(listPipelineItems);
  const pipeline = useQuery({
    queryKey: ["treasury", "pipeline"],
    queryFn: () => fetchPipeline(),
    refetchInterval: 60_000,
  });

  const [ltv, setLtv] = useState(60);
  const [apr, setApr] = useState(9.5);
  const [drawPct, setDrawPct] = useState(50);

  const items = pipeline.data ?? [];

  const { settledFees, pipelineFees } = useMemo(() => {
    let settled = 0;
    let pipe = 0;
    for (const i of items) {
      const fee = Number((i as any).optimized_acquisition_premium ?? 0);
      if (SETTLED.includes(String((i as any).status))) settled += fee;
      else pipe += fee;
    }
    return { settledFees: settled, pipelineFees: pipe };
  }, [items]);

  const facility = BALANCE_SHEET_ASSETS * (ltv / 100);
  const drawn = facility * (drawPct / 100);
  const annualInterest = drawn * (apr / 100);
  const annualizedNOI = settledFees * 12; // trailing-month fee yield annualized
  const dscr = annualInterest > 0 ? annualizedNOI / annualInterest : 0;

  return (
    <main className="min-h-screen bg-background p-3 md:p-6">
      <div className="mx-auto max-w-[1200px] space-y-4">
        <header className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="font-mono text-[11px] uppercase tracking-widest text-muted-foreground">
              /admin/treasury · capital stack
            </h1>
            <p className="text-xl font-semibold sm:text-2xl">
              Treasury &amp; Entity Structure
            </p>
          </div>
          <Link
            to="/admin"
            className="rounded border px-3 py-1.5 font-mono text-[11px] hover:bg-muted"
          >
            ← Terminal
          </Link>
        </header>

        {/* Entity ownership */}
        <section className="rounded-lg border bg-card p-4">
          <div className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
            Entity Ownership Structure
          </div>
          <div className="mt-4 grid gap-3 md:grid-cols-3">
            <EntityNode
              tier="Sovereign Layer"
              name="Family Trust"
              detail="100% equity holder · non-probate · liability-remote"
              accent
            />
            <EntityNode
              tier="Operating Layer"
              name="Operating LLC (Clearinghouse)"
              detail="Holds capitalized software intangibles (ASC 350-40) + restricted escrow deal tape"
            />
            <EntityNode
              tier="Leverage Layer"
              name="Lender Network"
              detail="Revolving credit facility secured by pledged balance sheet"
            />
          </div>
          <pre className="mt-4 overflow-auto rounded border bg-muted/40 p-3 font-mono text-[11px] leading-5 text-muted-foreground">
{`Family Trust (100% equity)
   └── Operating LLC ──pledge──> Lender Network
            └── Servicing Layer (Dark Pool spread capture → debt service)`}
          </pre>
        </section>

        {/* Borrowing base */}
        <section className="rounded-lg border bg-card p-4">
          <div className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
            Borrowing Base Calculator
          </div>
          <div className="mt-3 grid gap-3 md:grid-cols-3">
            <Stat label="Audited Asset Value (GAAP)" value={usd(BALANCE_SHEET_ASSETS)} />
            <Stat label={`Advance Rate · LTV ${ltv}%`} value={`${ltv}%`} />
            <Stat
              label="Available Revolving Facility"
              value={usd(facility)}
              accent
            />
          </div>
          <div className="mt-4 space-y-4">
            <Slider
              label="Loan-to-Value"
              min={40}
              max={75}
              step={1}
              value={ltv}
              onChange={setLtv}
              suffix="%"
            />
            <Slider
              label="Facility Drawn"
              min={0}
              max={100}
              step={5}
              value={drawPct}
              onChange={setDrawPct}
              suffix="%"
            />
            <Slider
              label="Interest Rate (APR)"
              min={4}
              max={16}
              step={0.25}
              value={apr}
              onChange={setApr}
              suffix="%"
            />
          </div>
          <div className="mt-4 grid gap-3 md:grid-cols-3">
            <Stat label="Drawn Balance" value={usd(drawn)} />
            <Stat label="Annual Interest Expense" value={usd(annualInterest)} />
            <Stat label="Undrawn Capacity" value={usd(facility - drawn)} />
          </div>
        </section>

        {/* DSCR / OPM */}
        <section className="rounded-lg border bg-card p-4">
          <div className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
            Debt Servicing · Other People&apos;s Money
          </div>
          <div className="mt-3 grid gap-3 md:grid-cols-3">
            <Stat label="Cleared Fee Yield (settled)" value={usd(settledFees)} />
            <Stat label="Annualized Clearing Income" value={usd(annualizedNOI)} />
            <Stat
              label="Debt Service Coverage Ratio"
              value={dscr ? `${dscr.toFixed(2)}x` : "—"}
              accent={dscr >= 1.25}
              danger={dscr > 0 && dscr < 1.25}
            />
          </div>
          <div className="mt-4">
            <div className="h-3 w-full overflow-hidden rounded-full bg-muted">
              <div
                className={`h-full transition-all ${
                  dscr >= 1.25 ? "bg-emerald-500" : "bg-amber-500"
                }`}
                style={{ width: `${Math.min(100, (dscr / 2) * 100)}%` }}
              />
            </div>
            <div className="mt-2 font-mono text-[11px] text-muted-foreground">
              {dscr >= 1.25
                ? "COVERED — automated clearing fees exceed interest obligations at 1.25x lender covenant."
                : "UNDER COVENANT — increase clearing velocity or reduce drawn balance to reach 1.25x."}
            </div>
            <div className="mt-2 font-mono text-[11px] text-muted-foreground">
              Unsettled pipeline fees (forward coverage): {usd(pipelineFees)}
            </div>
          </div>
        </section>

        <TriPartySweepLedger />
      </div>
    </main>
  );
}

function EntityNode({
  tier,
  name,
  detail,
  accent,
}: {
  tier: string;
  name: string;
  detail: string;
  accent?: boolean;
}) {
  return (
    <div
      className={`rounded-lg border p-3 ${
        accent ? "border-emerald-500/40 bg-emerald-500/5" : "bg-background"
      }`}
    >
      <div className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
        {tier}
      </div>
      <div className="mt-1 font-semibold">{name}</div>
      <div className="mt-1 text-xs text-muted-foreground">{detail}</div>
    </div>
  );
}

function Stat({
  label,
  value,
  accent,
  danger,
}: {
  label: string;
  value: string;
  accent?: boolean;
  danger?: boolean;
}) {
  return (
    <div className="rounded-lg border bg-background p-3">
      <div className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
        {label}
      </div>
      <div
        className={`mt-1 text-lg font-semibold sm:text-xl ${
          danger ? "text-amber-500" : accent ? "text-emerald-500" : ""
        }`}
      >
        {value}
      </div>
    </div>
  );
}

function Slider({
  label,
  min,
  max,
  step,
  value,
  onChange,
  suffix,
}: {
  label: string;
  min: number;
  max: number;
  step: number;
  value: number;
  onChange: (n: number) => void;
  suffix?: string;
}) {
  return (
    <label className="block">
      <div className="flex justify-between font-mono text-[11px] text-muted-foreground">
        <span>{label}</span>
        <span>
          {value}
          {suffix}
        </span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="mt-1 w-full accent-emerald-500"
      />
    </label>
  );
}
