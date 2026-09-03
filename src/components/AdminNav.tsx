import { Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { emitSyntheticSettlement } from "@/lib/synthetic-socket";

/** Signed-in-only admin navigation strip. */
export function AdminNav() {
  const [signedIn, setSignedIn] = useState(false);

  useEffect(() => {
    let active = true;
    supabase.auth.getUser().then(({ data }) => {
      if (active) setSignedIn(!!data.user);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => {
      setSignedIn(!!session?.user);
    });
    return () => {
      active = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  if (!signedIn) return null;

  return (
    <nav className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-border bg-background px-4 py-2 font-mono text-[11px] text-muted-foreground print:hidden">
      <Link to="/" className="hover:text-foreground" activeProps={{ className: "text-foreground" }}>
        TERMINAL
      </Link>
      <Link
        to="/admin/m2m"
        className="hover:text-foreground"
        activeProps={{ className: "text-foreground" }}
      >
        M2M Router
      </Link>
      <Link
        to="/admin/m2m/emails"
        className="hover:text-foreground"
        activeProps={{ className: "text-foreground" }}
      >
        Email Telemetry
      </Link>
      <Link
        to="/admin/ledger-tape"
        className="hover:text-foreground"
        activeProps={{ className: "text-foreground" }}
      >
        Ledger Tape / BTR
      </Link>
      <Link

        to="/admin/system-ledger"
        className="hover:text-foreground"
        activeProps={{ className: "text-foreground" }}
      >
        System Ledger &amp; Software Equity
      </Link>
      <Link
        to="/admin/institutional-data-room"
        className="hover:text-foreground"
        activeProps={{ className: "text-foreground" }}
      >
        Institutional Data Room &amp; GAAP Statement
      </Link>
      <Link
        to="/admin/anomalies"
        className="hover:text-foreground"
        activeProps={{ className: "text-foreground" }}
      >
        Ledger Anomaly Detector
      </Link>
      <button
        type="button"
        onClick={() => emitSyntheticSettlement()}
        className="ml-auto rounded border border-violet-500/60 px-2 py-0.5 text-violet-400 hover:text-violet-300"
        title="Frontend-only simulation — no database writes"
      >
        Run Synthetic Socket Test
      </button>
    </nav>
  );
}
