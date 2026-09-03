import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getEmailAudit } from "@/lib/email-audit.functions";

export const Route = createFileRoute("/_authenticated/admin/m2m/emails")({
  head: () => ({
    meta: [
      { title: "Email Dispatch Telemetry" },
      { name: "description", content: "Live outbound email dispatch, engagement and deliverability telemetry." },
      { property: "og:title", content: "Email Dispatch Telemetry" },
      { property: "og:description", content: "Live outbound email dispatch, engagement and deliverability telemetry." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "robots", content: "noindex,nofollow" },
    ],
  }),
  component: EmailAuditPage,
  errorComponent: ({ error }) => (
    <div className="p-6 font-mono text-sm text-destructive">ERR :: {error.message}</div>
  ),
});

function badge(s: string) {
  if (s === "EXECUTED") return "border-emerald-500/40 bg-emerald-500/10 text-emerald-400";
  if (s === "BOUNCED" || s === "FAILED" || s === "REJECTED")
    return "border-destructive/40 bg-destructive/10 text-destructive";
  if (s === "CLICKED" || s === "OPENED") return "border-sky-500/40 bg-sky-500/10 text-sky-400";
  return "border-border bg-muted text-muted-foreground";
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="border border-border p-3">
      <div className="text-[10px] uppercase tracking-widest text-muted-foreground">{label}</div>
      <div className="mt-1 text-xl tabular-nums">{value}</div>
    </div>
  );
}

function EmailAuditPage() {
  const fetchAudit = useServerFn(getEmailAudit);
  const { data, isLoading, error } = useQuery({
    queryKey: ["email-audit"],
    queryFn: () => fetchAudit(),
    refetchInterval: 30_000,
  });

  return (
    <main className="p-4 font-mono text-sm">
      <h1 className="mb-3 text-xs uppercase tracking-widest text-muted-foreground">
        Live Dispatch Telemetry
      </h1>

      {isLoading && <div className="text-muted-foreground">LOADING…</div>}
      {error && <div className="text-destructive">ERR :: {(error as Error).message}</div>}

      {data && (
        <>
          <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
            <Stat label="Total Sent" value={String(data.totals.sent)} />
            <Stat label="Open Rate" value={`${data.totals.openRate}%`} />
            <Stat label="Click Rate" value={`${data.totals.clickRate}%`} />
            <Stat label="Bounce Rate" value={`${data.totals.bounceRate}%`} />
          </div>

          <div className="mt-2 border border-border p-3 text-[11px] text-muted-foreground">
            THROTTLE :: {data.guardrails.lastHour}/{data.guardrails.hourlyCap} sent in last 60m ·
            COOLDOWN :: {data.guardrails.cooldownHours}h per buyer · DEDUPE :: (property_id, buyer_id) unique
          </div>

          <div className="mt-4 overflow-x-auto border border-border">
            <table className="w-full text-left text-[11px]">
              <thead className="bg-muted/40 text-muted-foreground">
                <tr>
                  <th className="p-2">Buyer Email</th>
                  <th className="p-2">Property APN</th>
                  <th className="p-2">Status</th>
                  <th className="p-2">Timestamp</th>
                </tr>
              </thead>
              <tbody>
                {data.rows.length === 0 && (
                  <tr>
                    <td colSpan={4} className="p-3 text-muted-foreground">
                      NO DISPATCH RECORDS
                    </td>
                  </tr>
                )}
                {data.rows.map((r) => (
                  <tr key={r.id} className="border-t border-border">
                    <td className="p-2">{r.recipient_email ?? "—"}</td>
                    <td className="p-2">{r.apn ?? "—"}</td>
                    <td className="p-2">
                      <span className={`border px-1.5 py-0.5 ${badge(r.status)}`}>{r.status}</span>
                    </td>
                    <td className="p-2 tabular-nums text-muted-foreground">
                      {new Date(r.created_at).toISOString().replace("T", " ").slice(0, 19)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </main>
  );
}
