import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getDeliveryAudit } from "@/lib/offer-telemetry.functions";
import { supabase } from "@/integrations/supabase/client";

const DELIVERY = ["DISPATCHED", "DELIVERED"];
const ENGAGE = ["OPENED", "CLICKED", "EXECUTED", "REJECTED"];

function badge(s: string) {
  if (s === "EXECUTED") return "border-emerald-500/40 bg-emerald-500/10 text-emerald-400";
  if (s === "REJECTED") return "border-red-500/40 bg-red-500/10 text-red-400";
  if (s === "CLICKED" || s === "OPENED") return "border-sky-500/40 bg-sky-500/10 text-sky-400";
  return "border-border bg-muted text-muted-foreground";
}

export function DeliveryAuditTable() {
  const fetchAudit = useServerFn(getDeliveryAudit);
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ["mt", "delivery-audit"],
    queryFn: () => fetchAudit(),
    refetchInterval: 60_000,
  });

  useEffect(() => {
    const ch = supabase
      .channel("delivery-audit")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "offer_delivery_logs" },
        () => void qc.invalidateQueries({ queryKey: ["mt", "delivery-audit"] }),
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(ch);
    };
  }, [qc]);

  const rows = q.data ?? [];

  return (
    <section className="rounded-lg border bg-card">
      <div className="flex items-center justify-between border-b p-3">
        <h3 className="font-mono text-[11px] uppercase tracking-widest text-muted-foreground">
          Delivery &amp; Engagement Audit
        </h3>
        <span className="font-mono text-[11px] text-muted-foreground">{rows.length} events</span>
      </div>
      <div className="max-h-[420px] overflow-auto">
        <table className="w-full font-mono text-[11px]">
          <thead className="sticky top-0 bg-muted/60 text-left text-muted-foreground">
            <tr>
              <th className="p-2">Recipient</th>
              <th className="p-2">Notice Subject</th>
              <th className="p-2">Timestamp</th>
              <th className="p-2">Delivery</th>
              <th className="p-2">Engagement</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-t border-border/60 hover:bg-muted/30">
                <td className="p-2 max-w-[180px] truncate">{r.recipient_email ?? "—"}</td>
                <td className="p-2 max-w-[280px] truncate">{r.subject ?? "—"}</td>
                <td className="p-2 text-muted-foreground">
                  {new Date(r.created_at).toLocaleString()}
                </td>
                <td className="p-2">
                  {DELIVERY.includes(r.status) ? (
                    <span className={`rounded border px-1.5 py-0.5 ${badge(r.status)}`}>{r.status}</span>
                  ) : (
                    "—"
                  )}
                </td>
                <td className="p-2">
                  {ENGAGE.includes(r.status) ? (
                    <span className={`rounded border px-1.5 py-0.5 ${badge(r.status)}`}>{r.status}</span>
                  ) : (
                    "—"
                  )}
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td className="p-4 text-muted-foreground" colSpan={5}>
                  No delivery events logged yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
