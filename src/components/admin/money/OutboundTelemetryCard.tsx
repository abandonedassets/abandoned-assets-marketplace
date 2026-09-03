import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getOfferTelemetry, REJECTION_LABELS, type RejectionCode } from "@/lib/offer-telemetry.functions";
import { supabase } from "@/integrations/supabase/client";

export function OutboundTelemetryCard() {
  const fetchTelemetry = useServerFn(getOfferTelemetry);
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ["mt", "offer-telemetry"],
    queryFn: () => fetchTelemetry(),
    refetchInterval: 30_000,
  });

  useEffect(() => {
    const ch = supabase
      .channel("offer-telemetry")
      .on("postgres_changes", { event: "*", schema: "public", table: "offer_delivery_logs" }, () =>
        qc.invalidateQueries({ queryKey: ["mt", "offer-telemetry"] }),
      )
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "closing_pipeline_items" }, () =>
        qc.invalidateQueries({ queryKey: ["mt", "offer-telemetry"] }),
      )
      .subscribe();
    return () => void supabase.removeChannel(ch);
  }, [qc]);

  const d = q.data;
  const sent = d?.sent ?? 0;
  const ctr = sent > 0 ? Math.round(((d?.clicked ?? 0) / sent) * 1000) / 10 : 0;
  const reasons = d?.reasons ?? [];
  const totalRej = reasons.reduce((s, r) => s + Number(r.n), 0);
  const top = reasons[0];

  return (
    <section className="rounded-lg border bg-card p-4">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="font-mono text-[11px] uppercase tracking-widest text-muted-foreground">
          outbound telemetry & rejection analytics
        </h2>
        <span className="font-mono text-[10px] text-muted-foreground">live</span>
      </div>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <Cell label="Offers Sent" value={sent.toLocaleString()} />
        <Cell label="CTR" value={`${ctr}%`} accent />
        <Cell label="Active Opens" value={(d?.opened ?? 0).toLocaleString()} />
        <Cell label="Rejections" value={(d?.rejected ?? 0).toLocaleString()} />
        <Cell label="Executed" value={(d?.executed ?? 0).toLocaleString()} accent />
      </div>
      <div className="mt-3 font-mono text-[11px]">
        {top && totalRej > 0 ? (
          <p className="text-amber-500">
            Top reject cause: {Math.round((Number(top.n) / totalRej) * 100)}% ·{" "}
            {REJECTION_LABELS[top.code as RejectionCode] ?? top.code}
          </p>
        ) : (
          <p className="text-muted-foreground">No rejection signals yet.</p>
        )}
        {reasons.length > 0 && (
          <ul className="mt-2 space-y-1 text-muted-foreground">
            {reasons.map((r) => (
              <li key={r.code} className="flex justify-between">
                <span>{REJECTION_LABELS[r.code as RejectionCode] ?? r.code}</span>
                <span>{r.n}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

function Cell({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="rounded-lg border bg-background p-3">
      <div className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">{label}</div>
      <div className={`mt-1 text-lg font-semibold ${accent ? "text-emerald-500" : ""}`}>{value}</div>
    </div>
  );
}
