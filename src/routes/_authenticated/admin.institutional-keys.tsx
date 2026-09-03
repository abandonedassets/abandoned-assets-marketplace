import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { listApiKeys, createApiKey, revokeApiKey } from "@/lib/admin-keys.functions";
import { CounterpartyFunnel } from "@/components/admin/CounterpartyFunnel";

export const Route = createFileRoute("/_authenticated/admin/institutional-keys")({
  head: () => ({
    meta: [
      { title: "Institutional Keys — Reverse Inquiry Portal" },
      {
        name: "description",
        content: "Issue read-only bearer tokens for algorithmic buyers consuming the deal tape.",
      },
      { name: "robots", content: "noindex,nofollow" },
    ],
  }),
  component: KeysPortal,
  errorComponent: ({ error }) => (
    <div className="p-6 font-mono text-sm text-destructive">ERR :: {(error as Error).message}</div>
  ),
  notFoundComponent: () => <div className="p-6 font-mono text-sm">404</div>,
});

const PAYLOAD_SPEC = `{
  "tranche_id": "uuid",
  "target_zip": "45402",
  "net_yield": 0.1842,                // float
  "avm_valuation": 184000,            // integer (USD)
  "rehab_estimate": 41500,            // integer (USD)
  "base_contract_price": 96000,       // integer (USD)
  "explicit_assignment_fee": 6700,    // integer (USD)
  "total_acquisition_cost": 102700,   // integer (USD)
  "status": "BUYER_MATCHED",
  "hours_since_last_update": 6
}`;

function KeysPortal() {
  const listFn = useServerFn(listApiKeys);
  const createFn = useServerFn(createApiKey);
  const revokeFn = useServerFn(revokeApiKey);
  const qc = useQueryClient();

  const keysQ = useQuery({
    queryKey: ["institutional-keys"],
    queryFn: () => listFn({ data: {} as never }),
    refetchInterval: 60_000,
  });

  const [name, setName] = useState("");
  const [issued, setIssued] = useState<{ label: string; raw_key: string } | null>(null);

  const mCreate = useMutation({
    mutationFn: (buyer_name: string) => createFn({ data: { buyer_name } }),
    onSuccess: (r) => {
      setIssued({ label: r.label, raw_key: r.raw_key });
      setName("");
      toast.success("Institutional token issued");
      qc.invalidateQueries({ queryKey: ["institutional-keys"] });
    },
    onError: (e: Error) => toast.error(`Issue failed :: ${e.message}`),
  });

  const mRevoke = useMutation({
    mutationFn: (id: string) => revokeFn({ data: { id } }),
    onSuccess: () => {
      toast.success("Token revoked");
      qc.invalidateQueries({ queryKey: ["institutional-keys"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const rows = keysQ.data ?? [];

  return (
    <div className="min-h-screen bg-zinc-950 font-mono text-zinc-200">
      <header className="border-b border-zinc-800 px-4 py-3 sm:px-6">
        <div className="text-[10px] uppercase tracking-[0.2em] text-zinc-500">
          /admin/institutional-keys
        </div>
        <h1 className="text-lg font-bold text-emerald-400">REVERSE-INQUIRY API PORTAL</h1>
      </header>

      <div className="p-4 sm:p-6">
        <CounterpartyFunnel />
      </div>

      <section className="border-b border-zinc-800 p-4 sm:p-6">
        <h2 className="mb-3 text-[10px] uppercase tracking-[0.2em] text-zinc-500">
          Issue token · hedge fund / algo buyer
        </h2>
        <div className="flex flex-col gap-2 sm:flex-row">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Fund / desk name"
            className="h-11 flex-1 border border-zinc-700 bg-zinc-900 px-3 text-sm text-zinc-100 placeholder:text-zinc-600"
          />
          <button
            type="button"
            disabled={!name.trim() || mCreate.isPending}
            onClick={() => mCreate.mutate(name.trim())}
            className="h-11 border border-emerald-500/50 bg-emerald-500/10 px-4 text-xs uppercase tracking-[0.2em] text-emerald-300 transition hover:bg-emerald-500/20 disabled:opacity-40"
          >
            ▸ Generate Institutional Token
          </button>
        </div>

        {issued && (
          <div className="mt-4 border border-amber-500/40 bg-amber-500/5 p-3 text-xs">
            <div className="uppercase tracking-[0.2em] text-amber-300">
              Copy now — shown once · {issued.label}
            </div>
            <code className="mt-2 block break-all text-emerald-300">{issued.raw_key}</code>
            <button
              type="button"
              onClick={() => {
                void navigator.clipboard.writeText(issued.raw_key);
                toast.success("Copied");
              }}
              className="mt-2 border border-zinc-600 px-2 py-1 text-[10px] uppercase tracking-[0.2em] text-zinc-300"
            >
              copy
            </button>
          </div>
        )}
      </section>

      <section className="border-b border-zinc-800 p-4 sm:p-6">
        <h2 className="mb-3 text-[10px] uppercase tracking-[0.2em] text-zinc-500">
          Machine payload contract · GET /api/v1/institutional-tape
        </h2>
        <pre className="overflow-x-auto border border-zinc-800 bg-zinc-900/60 p-3 text-[11px] leading-relaxed text-zinc-300">
{`curl -H "Authorization: Bearer sk_live_v1_…" \\
  https://asset-weaver-30.lovable.app/api/v1/institutional-tape`}
        </pre>
        <pre className="mt-3 overflow-x-auto border border-zinc-800 bg-zinc-900/60 p-3 text-[11px] leading-relaxed text-emerald-300">
          {PAYLOAD_SPEC}
        </pre>
      </section>

      <section className="p-4 sm:p-6">
        <h2 className="mb-3 text-[10px] uppercase tracking-[0.2em] text-zinc-500">
          Active tokens ({rows.length})
        </h2>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-zinc-900/60 text-left text-[10px] uppercase tracking-wider text-zinc-500">
              <tr>
                <th className="px-3 py-2 font-normal">Buyer</th>
                <th className="px-3 py-2 font-normal">Prefix</th>
                <th className="px-3 py-2 font-normal">RPM</th>
                <th className="px-3 py-2 font-normal">Last used</th>
                <th className="px-3 py-2 font-normal">State</th>
                <th className="px-3 py-2 text-right font-normal">⋯</th>
              </tr>
            </thead>
            <tbody>
              {keysQ.isLoading && (
                <tr><td colSpan={6} className="px-3 py-6 text-zinc-500">loading…</td></tr>
              )}
              {!keysQ.isLoading && rows.length === 0 && (
                <tr><td colSpan={6} className="px-3 py-6 text-zinc-500">NO TOKENS ISSUED</td></tr>
              )}
              {rows.map((k) => (
                <tr key={k.id} className="border-t border-zinc-900">
                  <td className="px-3 py-2 text-zinc-100">{k.label}</td>
                  <td className="px-3 py-2 text-zinc-400">{k.key_prefix}…</td>
                  <td className="px-3 py-2 tabular-nums text-zinc-400">{k.rate_limit_per_minute}</td>
                  <td className="px-3 py-2 text-zinc-400">
                    {k.last_used_at ? new Date(k.last_used_at).toLocaleString() : "never"}
                  </td>
                  <td className="px-3 py-2">
                    <span className={k.is_active ? "text-emerald-400" : "text-rose-400"}>
                      {k.is_active ? "active" : "revoked"}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-right">
                    {k.is_active && (
                      <button
                        type="button"
                        disabled={mRevoke.isPending}
                        onClick={() => mRevoke.mutate(k.id)}
                        className="border border-rose-500/40 px-2 py-1 text-[10px] uppercase tracking-[0.15em] text-rose-300 disabled:opacity-40"
                      >
                        ✕ revoke
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
