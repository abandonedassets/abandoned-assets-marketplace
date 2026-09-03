import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { getBeneficiaryLiability } from "@/lib/banking.functions";

const usd = (n: number) =>
  `$${(Number(n) || 0).toLocaleString("en-US", { maximumFractionDigits: 2 })}`;

const LABEL: Record<string, string> = {
  DAUGHTER: "Daughter",
  JACQUITA: "Jacquita",
  PRIMARY: "Retained (Primary)",
};

export function BeneficiaryLiability() {
  const fn = useServerFn(getBeneficiaryLiability);
  const [authed, setAuthed] = useState(false);

  useEffect(() => {
    let active = true;
    supabase.auth.getSession().then(({ data }) => {
      if (active) setAuthed(!!data.session);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => {
      setAuthed(!!session);
    });
    return () => {
      active = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  const q = useQuery({
    queryKey: ["beneficiary-liability"],
    queryFn: () => fn(),
    enabled: authed,
    refetchInterval: 60_000,
    retry: false,
  });
  const d: any = q.data;
  if (!authed || q.isError || !d) return null;

  return (
    <section className="border-border bg-card rounded-lg border p-5">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-sm font-semibold tracking-wide uppercase">
          Beneficiary Liability Summary
        </h2>
        <span className="bg-primary/10 text-primary rounded-full px-3 py-1 text-[11px] font-bold tracking-wide uppercase">
          Internal sub-ledger
        </span>
      </div>

      <p className="text-muted-foreground mb-4 text-xs">
        All settlement proceeds land in the primary account. These are the internal credit
        balances accrued per beneficiary — distribute manually when ready.
      </p>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        {(d.balances ?? []).map((b: any) => (
          <div key={b.key} className="border-border rounded-md border p-4">
            <div className="text-muted-foreground text-[10px] tracking-wide uppercase">
              {LABEL[b.key] ?? b.key}
            </div>
            <div className="mt-1 text-xl font-bold">{usd(b.accrued_usd)}</div>
            <div className="text-muted-foreground mt-1 text-[11px]">
              {b.count} allocation{b.count === 1 ? "" : "s"}
              {b.settled_usd > 0 ? ` · ${usd(b.settled_usd)} distributed` : ""}
            </div>
          </div>
        ))}
      </div>

      <div className="border-border mt-4 flex items-center justify-between border-t pt-3 text-sm">
        <span className="text-muted-foreground">Total outstanding liability</span>
        <span className="font-mono font-semibold">{usd(d.total_outstanding_usd)}</span>
      </div>
    </section>
  );
}
