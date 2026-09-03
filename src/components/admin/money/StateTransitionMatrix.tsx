const RULES: Array<{ from: string; cond: string; to: string }> = [
  {
    from: "Pending-Underwriting",
    cond: "confidence_score ≥ 50 AND assignment_fee > 0",
    to: "New / Dispatch-Ready",
  },
  {
    from: "Dispatch-Ready",
    cond: "buy box active AND execution_mode = M2M AND webhook_url reachable",
    to: "Webhook_Dispatched (60s TIF hold)",
  },
  {
    from: "Webhook_Dispatched",
    cond: "fund POSTs /api/v1/m2m/accept with valid key inside 60s",
    to: "WIRE_PENDING_VERIFICATION",
  },
  {
    from: "Webhook_Dispatched",
    cond: "no accept before m2m_expires_at",
    to: "Re-cascade to next buy box (waterfall)",
  },
  {
    from: "WIRE_PENDING_VERIFICATION",
    cond: "inbound wire / ACH webhook matches memo_id AND amount ≥ assignment_fee",
    to: "Funds-Cleared (escrow CLEARED)",
  },
  {
    from: "Funds-Cleared",
    cond: "payout executed on live rail (T+2 business)",
    to: "SETTLED_PAID → Total Fees Settled",
  },
];

export function StateTransitionMatrix() {
  return (
    <section className="rounded-lg border bg-card p-4">
      <h2 className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
        state transition rules matrix
      </h2>
      <div className="mt-3 overflow-x-auto">
        <table className="w-full font-mono text-[11px]">
          <thead className="text-muted-foreground">
            <tr className="text-left">
              <th className="py-1 font-normal">FROM</th>
              <th className="py-1 font-normal">TRIGGER CONDITION</th>
              <th className="py-1 font-normal">TO</th>
            </tr>
          </thead>
          <tbody>
            {RULES.map((r) => (
              <tr key={r.from + r.to} className="border-t border-border/50 align-top">
                <td className="py-1 pr-3 whitespace-nowrap">{r.from}</td>
                <td className="py-1 pr-3 text-muted-foreground">{r.cond}</td>
                <td className="py-1 whitespace-nowrap text-emerald-500">{r.to}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
