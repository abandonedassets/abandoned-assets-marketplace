import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getMissionControlPulse } from "@/lib/mission-control.functions";
import { getOpsHealth } from "@/lib/ops-health.functions";
import { Link } from "@tanstack/react-router";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { getAlertConfig, setAlertConfig, sendTestPing } from "@/lib/alerts.functions";

export const Route = createFileRoute("/_authenticated/admin/mission-control")({
  head: () => ({ meta: [{ title: "Mission Control — Master Command Engine" }] }),
  component: MissionControl,
  errorComponent: ({ error, reset }) => {
    const router = useRouter();
    return (
      <div className="p-6">
        <p className="text-destructive">Pulse offline: {(error as Error).message}</p>
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

function fmt(n: unknown) {
  const v = Number(n ?? 0);
  return Number.isFinite(v) ? v.toLocaleString() : "0";
}
function usd(n: unknown) {
  const v = Number(n ?? 0);
  return v.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
}

function MissionControl() {
  const pulse = useServerFn(getMissionControlPulse);
  const { data, isLoading } = useQuery({
    queryKey: ["mission-control-pulse"],
    queryFn: () => pulse(),
    refetchInterval: 15_000,
  });

  const healthFn = useServerFn(getOpsHealth);
  const { data: health } = useQuery({
    queryKey: ["ops-health"],
    queryFn: () => healthFn(),
    refetchInterval: 30_000,
  });

  const p = (data ?? {}) as Record<string, any>;
  const routes: any[] = Array.isArray(p.recent_routes) ? p.recent_routes : [];

  return (
    <div className="p-6 space-y-6">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Mission Control</h1>
          <p className="text-sm text-muted-foreground">
            Master Command Engine telemetry · refreshes every 15s
          </p>
        </div>
        {isLoading ? <Badge variant="outline">Syncing…</Badge> : <Badge>Live</Badge>}
      </header>

      <div className="flex flex-wrap items-center gap-3 rounded-md border border-border bg-muted/20 p-3 font-mono text-xs">
        <span className="uppercase tracking-widest text-muted-foreground">Ops Health</span>
        <span
          className={`rounded border px-2 py-1 ${
            health?.dlq_ok === false
              ? "border-destructive text-destructive"
              : "border-emerald-600 text-emerald-500"
          }`}
        >
          DLQ {fmt(health?.dlq_count)} {health?.dlq_ok === false ? "· CRITICAL" : "· OK"}
        </span>
        <span className="rounded border border-border px-2 py-1">
          Exceptions {fmt(health?.exception_count)}
        </span>
        <span className="rounded border border-border px-2 py-1">
          Config keys {fmt(health?.config_keys)} active
        </span>
        <span className="rounded border border-cyan-600 px-2 py-1 text-cyan-400">
          In-Escrow 7d {fmt(health?.in_escrow_7d)} · total {fmt(health?.in_escrow_total)}
        </span>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <Tile label="Total Contracts" value={fmt(p.total_contracts)} />
        <Tile label="Master Owned" value={fmt(p.master_count)} />
        <Tile label="Partner Owned" value={fmt(p.partner_count)} />
        <Tile label="Partner Share (cumulative)" value={usd(p.partner_share_total)} />
        <Tile label="Assets / Minute (60m)" value={fmt(p.apm_last_60m)} />
        <Tile label="Matching Latency (avg ms)" value={fmt(p.matching_latency_ms_avg)} sub={`p95 ${fmt(p.matching_latency_ms_p95)}ms`} />
      </div>

      <SmsAlertPanel />

      <Card>
        <CardHeader><CardTitle>Error Vector (24h)</CardTitle></CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-3">
          <Tile label="429 Rate-Limit" value={fmt(p.error_vector_429)} />
          <Tile label="401/403 Auth" value={fmt(p.error_vector_auth)} />
          <Tile label="DLQ Total" value={fmt(p.error_vector_total)} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Black-Box Routing Log (latest 25)</CardTitle></CardHeader>
        <CardContent>
          <div className="space-y-1 font-mono text-xs">
            {routes.length === 0 && <p className="text-muted-foreground">No routing events yet.</p>}
            {routes.map((r, i) => (
              <div key={i} className="flex flex-wrap gap-2 border-b border-border/40 py-1">
                <span className="text-muted-foreground">{new Date(r.at).toLocaleTimeString()}</span>
                <Badge variant={r.owner === "Master" ? "default" : "secondary"}>{r.owner}</Badge>
                <span>{usd(r.fee)}</span>
                {Number(r.partner_share) > 0 && (
                  <span className="text-emerald-500">split {usd(r.partner_share)}</span>
                )}
                <span className="text-muted-foreground">{r.rule}</span>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function Tile({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <Card>
      <CardContent className="pt-6">
        <p className="text-xs uppercase text-muted-foreground">{label}</p>
        <p className="text-2xl font-bold">{value}</p>
        {sub && <p className="text-xs text-muted-foreground">{sub}</p>}
      </CardContent>
    </Card>
  );
}

function SmsAlertPanel() {
  const getCfg = useServerFn(getAlertConfig);
  const saveCfg = useServerFn(setAlertConfig);
  const testFn = useServerFn(sendTestPing);
  const qc = useQueryClient();

  const { data } = useQuery({ queryKey: ["alert-config"], queryFn: () => getCfg() });
  const [enabled, setEnabled] = useState(false);
  const [phone, setPhone] = useState("");
  const [minFee, setMinFee] = useState("0");

  useEffect(() => {
    if (!data) return;
    setEnabled(data.enabled);
    setPhone(data.phone);
    setMinFee(String(data.min_fee_usd));
  }, [data]);

  const mSave = useMutation({
    mutationFn: () =>
      saveCfg({ data: { enabled, phone, min_fee_usd: Number(minFee) || 0 } }),
    onSuccess: () => {
      toast.success("Alert routing saved");
      qc.invalidateQueries({ queryKey: ["alert-config"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const mTest = useMutation({
    mutationFn: () => testFn(),
    onSuccess: (r: any) =>
      r.ok ? toast.success("Test SMS sent") : toast.error(`SMS :: ${r.status}`),
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          SMS Alert Routing
          <Badge variant={data?.twilio_configured ? "default" : "destructive"}>
            {data?.twilio_configured ? "Twilio linked" : "Twilio credentials missing"}
          </Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <label className="flex items-center gap-3 text-sm">
          <input
            type="checkbox"
            checked={enabled}
            onChange={(e) => setEnabled(e.target.checked)}
            className="h-5 w-5"
          />
          Instant Ping on Escrow Lock
        </label>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="grid gap-1 text-xs uppercase text-muted-foreground">
            Destination (E.164)
            <input
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="+15551234567"
              className="h-10 rounded-md border border-input bg-background px-3 text-sm text-foreground"
            />
          </label>
          <label className="grid gap-1 text-xs uppercase text-muted-foreground">
            Min fee to alert (USD)
            <input
              value={minFee}
              onChange={(e) => setMinFee(e.target.value)}
              inputMode="numeric"
              className="h-10 rounded-md border border-input bg-background px-3 text-sm text-foreground"
            />
          </label>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => mSave.mutate()}
            disabled={mSave.isPending}
            className="h-10 rounded-md border border-emerald-600 px-4 text-sm text-emerald-500 disabled:opacity-40"
          >
            Save routing
          </button>
          <button
            onClick={() => mTest.mutate()}
            disabled={mTest.isPending}
            className="h-10 rounded-md border border-border px-4 text-sm disabled:opacity-40"
          >
            Send test ping
          </button>
        </div>
        <p className="text-xs text-muted-foreground">
          Twilio credentials are stored as backend secrets (TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN,
          TWILIO_FROM_NUMBER) — never in the database or browser.
        </p>
      </CardContent>
    </Card>
  );
}
