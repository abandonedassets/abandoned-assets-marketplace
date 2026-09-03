// Live System Health & Telemetry Console — every row is a real probe result.
import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { runSystemDiagnostics, type Probe } from "@/lib/diagnostics.functions";

export function SystemDiagnostics() {
  const run = useServerFn(runSystemDiagnostics);
  const [probes, setProbes] = useState<Probe[] | null>(null);
  const [ranAt, setRanAt] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const execute = async () => {
    setBusy(true);
    try {
      const r = await run({ data: undefined as never });
      setProbes(r.probes);
      setRanAt(r.ran_at);
      const bad = r.probes.filter((p) => !p.ok);
      if (bad.length) toast.error(`${bad.length} endpoint(s) failing — see diagnostics console`);
      else toast.success("All endpoints healthy");
    } catch (e) {
      toast.error(`Diagnostics failed: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between gap-3 space-y-0 pb-2">
        <CardTitle className="font-mono text-sm">SYSTEM DIAGNOSTICS — LIVE ENDPOINT TELEMETRY</CardTitle>
        <div className="flex items-center gap-2">
          {ranAt ? (
            <Badge variant="outline" className="font-mono text-[10px]">
              {ranAt.slice(11, 19)}Z
            </Badge>
          ) : null}
          <Button size="sm" onClick={execute} disabled={busy}>
            {busy ? "Probing…" : "Run Diagnostics"}
          </Button>
        </div>
      </CardHeader>
      <CardContent className="overflow-x-auto">
        {!probes ? (
          <p className="font-mono text-[11px] text-muted-foreground">
            No probe run yet. Each probe issues a real HTTP/DB request and reports its status code,
            latency, and raw response body.
          </p>
        ) : (
          <table className="w-full font-mono text-xs">
            <thead className="text-muted-foreground">
              <tr className="text-left">
                <th className="py-1">ENDPOINT</th>
                <th className="py-1">MODE</th>
                <th className="py-1 text-right">HTTP</th>
                <th className="py-1 text-right">LATENCY</th>
                <th className="py-1">RESPONSE</th>
              </tr>
            </thead>
            <tbody>
              {probes.map((p) => (
                <tr key={p.name} className="border-t border-border align-top">
                  <td className="py-1">
                    {p.name}
                    <div className="max-w-[22rem] truncate text-[10px] text-muted-foreground">
                      {p.target}
                    </div>
                  </td>
                  <td className="py-1 text-muted-foreground">{p.mode}</td>
                  <td className={`py-1 text-right tabular-nums ${p.ok ? "text-emerald-500" : "text-destructive"}`}>
                    {p.status || "ERR"}
                  </td>
                  <td className="py-1 text-right tabular-nums text-muted-foreground">
                    {p.latency_ms}ms
                  </td>
                  <td className={`py-1 ${p.ok ? "text-muted-foreground" : "text-destructive"}`}>
                    <span className="line-clamp-3 break-all">{p.detail}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </CardContent>
    </Card>
  );
}
