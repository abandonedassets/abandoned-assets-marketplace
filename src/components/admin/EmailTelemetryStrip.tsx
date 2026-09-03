import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Link } from "@tanstack/react-router";
import { getEmailAudit } from "@/lib/email-audit.functions";
import { supabase } from "@/integrations/supabase/client";

function Cell({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div>
      <div className="text-[10px] font-medium uppercase tracking-[0.18em] text-zinc-500">
        {label}
      </div>
      <div className={`mt-1 font-mono text-2xl font-bold tabular-nums ${tone ?? "text-zinc-100"}`}>
        {value}
      </div>
    </div>
  );
}

export function EmailTelemetryStrip() {
  const fetchAudit = useServerFn(getEmailAudit);
  // Auth-gated: the server fn requires a bearer token, which does not exist
  // during SSR or for signed-out visitors.
  const [signedIn, setSignedIn] = useState(false);
  useEffect(() => {
    let alive = true;
    void supabase.auth.getSession().then(({ data }) => {
      if (alive) setSignedIn(!!data.session);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => {
      setSignedIn(!!session);
    });
    return () => {
      alive = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  const { data } = useQuery({
    queryKey: ["email-audit", "strip"],
    queryFn: () => fetchAudit(),
    enabled: signedIn,
    retry: false,
    refetchInterval: 60_000,
  });

  if (!signedIn) return null;

  const t = data?.totals;

  return (
    <section className="rounded-lg border border-zinc-800 bg-zinc-950/80 p-4">
      <div className="mb-3 flex items-center justify-between">
        <div className="text-[10px] font-medium uppercase tracking-[0.18em] text-zinc-500">
          Outbound Email Telemetry · live
        </div>
        <Link
          to="/admin/m2m/emails"
          className="font-mono text-[10px] uppercase tracking-widest text-zinc-500 hover:text-zinc-200"
        >
          Full log →
        </Link>
      </div>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Cell label="Sent" value={(t?.sent ?? 0).toLocaleString()} />
        <Cell label="Opened" value={(t?.opened ?? 0).toLocaleString()} tone="text-sky-400" />
        <Cell label="Clicked" value={(t?.clicked ?? 0).toLocaleString()} tone="text-emerald-400" />
        <Cell
          label="Bounced"
          value={(t?.bounced ?? 0).toLocaleString()}
          tone={(t?.bounced ?? 0) > 0 ? "text-red-400" : "text-zinc-100"}
        />
        <Cell
          label="Open / Click"
          value={`${t?.openRate ?? 0}% / ${t?.clickRate ?? 0}%`}
        />
      </div>
      <div className="mt-3 border-t border-zinc-800 pt-2 font-mono text-[10px] uppercase tracking-widest text-zinc-500">
        Throttle {data?.guardrails.lastHour ?? 0}/{data?.guardrails.hourlyCap ?? 25} last 60m ·
        Cooldown {data?.guardrails.cooldownHours ?? 24}h/buyer · Dedupe on (property, buyer)
      </div>
    </section>
  );
}
