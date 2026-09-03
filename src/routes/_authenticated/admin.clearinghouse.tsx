import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import {
  getClearinghouse,
  runExchangeSweep,
  runArvComps,
  getEngineStatus,
  runMasterCron,
} from "@/lib/qi-clearinghouse.functions";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/admin/clearinghouse")({
  head: () => ({
    meta: [
      { title: "1031 Clearinghouse Monitor — Exchange Match Engine" },
      {
        name: "description",
        content:
          "Live 1031 exchange clearinghouse: QI buyer 45-day countdowns, matched distress assets, and manual intake testing.",
      },
      { property: "og:title", content: "1031 Clearinghouse Monitor" },
      {
        property: "og:description",
        content: "QI exchange countdowns and matched distressed assets in real time.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: ClearinghouseView,
  errorComponent: ({ error, reset }) => {
    const router = useRouter();
    return (
      <div className="p-6">
        <p className="text-destructive">Clearinghouse offline: {(error as Error).message}</p>
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
  notFoundComponent: () => <div className="p-6">Not found</div>,
});

const usd = (n: unknown) =>
  Number(n ?? 0).toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  });

function useTick() {
  const [, set] = useState(0);
  useEffect(() => {
    const t = setInterval(() => set((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, []);
}

function Countdown({ deadline }: { deadline: string | null }) {
  if (!deadline) return <span className="text-muted-foreground">—</span>;
  const ms = Date.parse(deadline) - Date.now();
  if (!isFinite(ms) || ms <= 0) return <Badge variant="destructive">EXPIRED</Badge>;
  const d = Math.floor(ms / 86400_000);
  const h = Math.floor((ms % 86400_000) / 3600_000);
  const m = Math.floor((ms % 3600_000) / 60_000);
  const s = Math.floor((ms % 60_000) / 1000);
  const urgent = d < 10;
  return (
    <span className={urgent ? "font-mono font-semibold text-destructive" : "font-mono"}>
      {d}d {String(h).padStart(2, "0")}:{String(m).padStart(2, "0")}:{String(s).padStart(2, "0")}
    </span>
  );
}

function ArvBadge({ asset }: { asset: any }) {
  const n = Number(asset.arv_comp_count ?? 0);
  if (!n) return <Badge variant="outline">NO COMPS</Badge>;
  const band = n >= 8 ? "HIGH" : n >= 4 ? "MEDIUM" : "LOW";
  return (
    <Badge variant={band === "HIGH" ? "default" : "secondary"}>
      {band} · {n} · {asset.arv_source === "COUNTY_REST" ? "COUNTY" : "PUBLIC"}
    </Badge>
  );
}

function ClearinghouseView() {
  useTick();
  const qc = useQueryClient();
  const fetcher = useServerFn(getClearinghouse);
  const sweep = useServerFn(runExchangeSweep);
  const comps = useServerFn(runArvComps);
  const engineFetcher = useServerFn(getEngineStatus);
  const master = useServerFn(runMasterCron);
  const { data: engine } = useQuery({
    queryKey: ["qi-engine-status"],
    queryFn: () => engineFetcher(),
    refetchInterval: 30_000,
  });
  const { data, isLoading } = useQuery({
    queryKey: ["qi-clearinghouse"],
    queryFn: () => fetcher(),
    refetchInterval: 30_000,
  });

  const boxes = data?.boxes ?? [];
  const matched = data?.matched ?? [];
  const active = boxes.filter((b: any) => b.active && Date.parse(b.exchange_deadline_at ?? "") > Date.now());
  const capital = active.reduce((a: number, b: any) => a + Number(b.capital_to_deploy_usd ?? 0), 0);

  return (
    <div className="p-6 space-y-6">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">1031 Clearinghouse Monitor</h1>
          <p className="text-sm text-muted-foreground">
            QI exchangers on live 45-day clocks · sweep runs every 10 minutes
          </p>
        </div>
        <div className="flex items-center gap-2">
          {isLoading ? <Badge variant="outline">Syncing…</Badge> : <Badge>Live</Badge>}
          <Button
            size="sm"
            onClick={async () => {
              const res: any = await sweep();
              toast[res?.ok ? "success" : "error"](
                res?.ok ? `Sweep complete — ${res.dispatched ?? 0} dispatched` : "Sweep failed",
              );
              qc.invalidateQueries({ queryKey: ["qi-clearinghouse"] });
            }}
          >
            Run sweep now
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={async () => {
              const res: any = await comps();
              toast[res?.ok ? "success" : "error"](
                res?.ok ? `ARV comps run — ${res.scanned ?? 0} assets underwritten` : "Comps run failed",
              );
              qc.invalidateQueries({ queryKey: ["qi-clearinghouse"] });
            }}
          >
            Run ARV comps
          </Button>
        </div>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardHeader><CardTitle className="text-sm text-muted-foreground">Active Exchangers</CardTitle></CardHeader>
          <CardContent><div className="text-3xl font-bold">{active.length}</div></CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle className="text-sm text-muted-foreground">Capital To Deploy</CardTitle></CardHeader>
          <CardContent><div className="text-3xl font-bold">{usd(capital)}</div></CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle className="text-sm text-muted-foreground">Identified Assets</CardTitle></CardHeader>
          <CardContent><div className="text-3xl font-bold">{matched.length}</div></CardContent>
        </Card>
      </div>

      <Card className="border-primary/40">
        <CardHeader className="flex-row items-center justify-between space-y-0">
          <CardTitle>Autonomous Engine Status</CardTitle>
          <div className="flex items-center gap-2">
            <Badge>{engine?.cron ?? "RUNNING (10m interval)"}</Badge>
            <Button
              size="sm"
              variant="outline"
              onClick={async () => {
                const res: any = await master();
                toast[res?.ok ? "success" : "error"](
                  res?.ok
                    ? `Master cron: ${res.arvs_calculated ?? 0} ARVs · ${res.counters_sent ?? 0} counters · ${res.matches_dispatched ?? 0} matched`
                    : "Master cron failed",
                );
                qc.invalidateQueries({ queryKey: ["qi-engine-status"] });
                qc.invalidateQueries({ queryKey: ["qi-clearinghouse"] });
              }}
            >
              Run master cron
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
            {[
              ["Ingested", engine?.velocity?.ingested],
              ["Scored", engine?.velocity?.scored],
              ["Strike Sent", engine?.velocity?.strikeSent],
              ["1031 Matched", engine?.velocity?.matched],
              ["Dispatched", engine?.velocity?.dispatched],
            ].map(([label, val]) => (
              <div key={String(label)} className="rounded-md border p-3">
                <div className="text-xs text-muted-foreground">{String(label)}</div>
                <div className="text-xl font-bold">{Number(val ?? 0).toLocaleString()}</div>
              </div>
            ))}
          </div>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <div className="rounded-md border p-3">
              <div className="text-xs text-muted-foreground">Total Cleared 1031 Value</div>
              <div className="text-2xl font-bold">{usd(engine?.clearedValue)}</div>
            </div>
            <div className="rounded-md border p-3">
              <div className="text-xs text-muted-foreground">Pending Assignment Fees</div>
              <div className="text-2xl font-bold">{usd(engine?.pendingFees)}</div>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Active QI Exchangers — 45-Day Clocks</CardTitle></CardHeader>
        <CardContent>
          {boxes.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No 1031 buy boxes yet. Submit one with the intake form below.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-muted-foreground">
                    <th className="py-2 pr-4">QI Entity</th>
                    <th className="py-2 pr-4">Countdown</th>
                    <th className="py-2 pr-4 text-right">Max Price</th>
                    <th className="py-2 pr-4 text-right">Min Margin</th>
                    <th className="py-2 pr-4 text-right">Urgency</th>
                    <th className="py-2 pr-4 text-right">ZIPs</th>
                  </tr>
                </thead>
                <tbody>
                  {boxes.map((b: any) => (
                    <tr key={b.id} className="border-b last:border-0">
                      <td className="py-2 pr-4 font-medium">{b.qi_entity ?? b.label ?? b.id.slice(0, 8)}</td>
                      <td className="py-2 pr-4"><Countdown deadline={b.exchange_deadline_at ?? null} /></td>
                      <td className="py-2 pr-4 text-right">{usd(b.max_contract_price)}</td>
                      <td className="py-2 pr-4 text-right">{Number(b.min_placement_margin ?? 0)}%</td>
                      <td className="py-2 pr-4 text-right">{Number(b.urgency_score ?? 0).toFixed(2)}</td>
                      <td className="py-2 pr-4 text-right">{(b.target_zip_codes ?? []).length}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Identified Properties — Ready For Assignment</CardTitle></CardHeader>
        <CardContent>
          {matched.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No assets identified yet. The sweep attaches inventory automatically.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-muted-foreground">
                    <th className="py-2 pr-4">Asset</th>
                    <th className="py-2 pr-4">QI</th>
                    <th className="py-2 pr-4">Clock</th>
                    <th className="py-2 pr-4">Status</th>
                    <th className="py-2 pr-4">Allocation</th>
                    <th className="py-2 pr-4 text-right">Asking</th>
                    <th className="py-2 pr-4 text-right">Real ARV</th>
                    <th className="py-2 pr-4">Comps</th>
                    <th className="py-2 pr-4 text-right">Floor</th>
                    <th className="py-2 pr-4">Class</th>
                    <th className="py-2 pr-4 text-right">Target Fee</th>
                    <th className="py-2 pr-4 text-right">Cap Rate</th>
                    <th className="py-2 pr-4 text-right">Score</th>
                    <th className="py-2 pr-4">Auth</th>
                    <th className="py-2 pr-4">Claim Link</th>
                  </tr>
                </thead>
                <tbody>
                  {matched.map((a: any) => (
                    <tr key={a.id} className="border-b last:border-0">
                      <td className="py-2 pr-4 font-medium">
                        {a.address ?? "—"}
                        <span className="text-muted-foreground"> {a.city ?? ""} {a.state ?? ""} {a.zip ?? ""}</span>
                      </td>
                      <td className="py-2 pr-4">{a.qi_entity ?? "—"}</td>
                      <td className="py-2 pr-4"><Countdown deadline={a.exchange_deadline_at ?? null} /></td>
                      <td className="py-2 pr-4"><Badge variant="outline">{a.status}</Badge></td>
                      <td className="py-2 pr-4">
                        <Badge variant={a.title_x_compliant === false ? "destructive" : "secondary"}>
                          {a.title_x_compliant === false
                            ? "TITLE X SCREENED"
                            : (a.allocation_label ?? "—")}
                        </Badge>
                      </td>
                      <td className="py-2 pr-4 text-right">{usd(a.base_contract_price)}</td>
                      <td className="py-2 pr-4 text-right">
                        {a.calculated_arv ? usd(a.calculated_arv) : <span className="text-muted-foreground">—</span>}
                      </td>
                      <td className="py-2 pr-4"><ArvBadge asset={a} /></td>
                      <td className="py-2 pr-4 text-right">
                        {a.absolute_floor_price ? (
                          <span className="text-amber-500">{usd(a.absolute_floor_price)}</span>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </td>
                      <td className="py-2 pr-4">
                        <Badge variant="secondary">{a.asset_class ?? "—"}</Badge>
                      </td>
                      <td
                        className={`py-2 pr-4 text-right font-semibold ${a.fee_cleared ? "text-emerald-500" : "text-amber-500"}`}
                      >
                        {usd(a.target_fee ?? a.optimized_acquisition_premium)}
                      </td>
                      <td className="py-2 pr-4 text-right">
                        {a.projected_cap_rate != null
                          ? `${(a.projected_cap_rate * 100).toFixed(1)}%`
                          : "—"}
                      </td>
                      <td className="py-2 pr-4 text-right">{a.composite_score ?? "—"}</td>
                      <td className="py-2 pr-4">
                        {a.has_signed_marketing_auth ? (
                          <Badge className="bg-emerald-600 text-white hover:bg-emerald-600">SIGNED</Badge>
                        ) : (
                          <Badge className="bg-amber-500 text-black hover:bg-amber-500">PENDING E-SIGN</Badge>
                        )}
                      </td>
                      <td className="py-2 pr-4">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => {
                            const url = String(a.claim_url ?? "");
                            navigator.clipboard
                              .writeText(url)
                              .then(() => toast.success("Claim URL copied"))
                              .catch(() => toast.error("Copy failed"));
                          }}
                        >
                          Copy Claim URL
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <IntakeTester onDone={() => qc.invalidateQueries({ queryKey: ["qi-clearinghouse"] })} />
    </div>
  );
}

function IntakeTester({ onDone }: { onDone: () => void }) {
  const [form, setForm] = useState({
    qi_entity: "",
    target_zip_codes: "",
    max_contract_price: "",
    min_cap_rate: "",
    relinquished_closed_at: "",
  });
  const [busy, setBusy] = useState(false);
  const [out, setOut] = useState<string>("");

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  return (
    <Card>
      <CardHeader><CardTitle>Manual QI Intake Test</CardTitle></CardHeader>
      <CardContent className="space-y-3">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <Input placeholder="QI entity" value={form.qi_entity} onChange={set("qi_entity")} />
          <Input placeholder="Target ZIPs (comma separated)" value={form.target_zip_codes} onChange={set("target_zip_codes")} />
          <Input placeholder="Max contract price" inputMode="numeric" value={form.max_contract_price} onChange={set("max_contract_price")} />
          <Input placeholder="Min cap rate (e.g. 0.07)" inputMode="decimal" value={form.min_cap_rate} onChange={set("min_cap_rate")} />
          <Input placeholder="Relinquished close date (YYYY-MM-DD)" value={form.relinquished_closed_at} onChange={set("relinquished_closed_at")} />
        </div>
        <Button
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            try {
              const zips = form.target_zip_codes.split(",").map((z) => z.trim()).filter(Boolean);
              const body: Record<string, unknown> = {
                qi_entity: form.qi_entity,
                target_zip_codes: zips,
                max_contract_price: Number(form.max_contract_price) || 0,
              };
              if (form.min_cap_rate) body["min_cap_rate"] = Number(form.min_cap_rate);
              if (form.relinquished_closed_at) body["relinquished_closed_at"] = form.relinquished_closed_at;
              const res = await fetch("/api/public/qi/intake", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(body),
              });
              const json = await res.json();
              setOut(JSON.stringify(json, null, 2));
              toast[json?.ok ? "success" : "error"](json?.ok ? "Buy box created" : "Intake rejected");
              onDone();
            } catch (e) {
              setOut(String(e));
              toast.error("Intake failed");
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy ? "Submitting…" : "POST /api/public/qi/intake"}
        </Button>
        {out ? (
          <pre className="max-h-64 overflow-auto rounded bg-muted p-3 text-xs">{out}</pre>
        ) : null}
      </CardContent>
    </Card>
  );
}
