// Operator funnel: makes the "$0" reality legible — zeroes mean no
// counterparty has reached ACTIVE, not that the execution rails are broken.
import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  listCounterparties,
  setCounterpartyState,
  setCounterpartyPublicKey,
  revealCounterpartySecret,

  FUNNEL_STATES,
  type CounterpartyRow,
} from "@/lib/admin-keys.functions";

const NEXT: Record<string, string> = {
  INVITED: "PROVISIONED",
  PROVISIONED: "UAT_VERIFIED",
  UAT_VERIFIED: "PRODUCTION_ENABLED",
  PRODUCTION_ENABLED: "ACTIVE",
};

export function CounterpartyFunnel() {
  const listFn = useServerFn(listCounterparties);
  const stateFn = useServerFn(setCounterpartyState);
  const keyFn = useServerFn(setCounterpartyPublicKey);
  const qc = useQueryClient();
  const [pemFor, setPemFor] = useState<string | null>(null);
  const [pem, setPem] = useState("");

  const q = useQuery({
    queryKey: ["counterparty-funnel"],
    queryFn: () => listFn({ data: {} as never }),
    refetchInterval: 60_000,
  });

  const mState = useMutation({
    mutationFn: (v: { id: string; state: string }) => stateFn({ data: v }),
    onSuccess: () => {
      toast.success("Counterparty state advanced");
      qc.invalidateQueries({ queryKey: ["counterparty-funnel"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const mKey = useMutation({
    mutationFn: (v: { id: string; pem: string | null }) =>
      keyFn({ data: { ...v, require_asymmetric: Boolean(v.pem) } }),
    onSuccess: () => {
      setPemFor(null);
      setPem("");
      toast.success("Envelope public key registered");
      qc.invalidateQueries({ queryKey: ["counterparty-funnel"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const revealFn = useServerFn(revealCounterpartySecret);
  const [creds, setCreds] = useState<{
    label: string;
    key_id: string;
    hmac_secret: string | null;
  } | null>(null);
  const mReveal = useMutation({
    mutationFn: (v: { id: string }) => revealFn({ data: v }),
    onSuccess: (r) => setCreds(r as { label: string; key_id: string; hmac_secret: string | null }),
    onError: (e: Error) => toast.error(e.message),
  });

  const rows: CounterpartyRow[] = q.data?.rows ?? [];

  const counts = q.data?.counts ?? {};
  const active = counts["ACTIVE"] ?? 0;

  return (
    <section className="border border-zinc-800 bg-zinc-950 p-4 font-mono text-zinc-200">
      <div className="flex items-baseline justify-between">
        <h2 className="text-[10px] uppercase tracking-[0.2em] text-zinc-500">
          Counterparty governance funnel
        </h2>
        <span
          className={
            active > 0
              ? "text-[10px] uppercase tracking-[0.2em] text-emerald-400"
              : "text-[10px] uppercase tracking-[0.2em] text-amber-400"
          }
        >
          {active} active counterparties provisioned
        </span>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-5">
        {FUNNEL_STATES.map((s) => (
          <div key={s} className="border border-zinc-800 bg-zinc-900/50 p-2">
            <div className="text-lg font-bold text-emerald-300">{counts[s] ?? 0}</div>
            <div className="text-[9px] uppercase tracking-[0.15em] text-zinc-500">
              {s.replace(/_/g, " ")}
            </div>
          </div>
        ))}
      </div>

      {active === 0 && (
        <p className="mt-3 border border-amber-500/30 bg-amber-500/5 p-2 text-[11px] text-amber-200">
          Engine healthy · awaiting human governance. Settlement totals stay at $0 until a
          counterparty reaches ACTIVE (first signed intent on production rails).
        </p>
      )}

      <div className="mt-4 overflow-x-auto">
        <table className="w-full text-left text-[11px]">
          <thead className="text-zinc-500">
            <tr>
              <th className="py-1 pr-3">Counterparty</th>
              <th className="py-1 pr-3">Key</th>
              <th className="py-1 pr-3">State</th>
              <th className="py-1 pr-3">Envelope</th>
              <th className="py-1 pr-3">First intent</th>
              <th className="py-1" />
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-t border-zinc-900 align-top">
                <td className="py-2 pr-3 text-zinc-200">{r.label}</td>
                <td className="py-2 pr-3 text-zinc-500">{r.key_prefix}…</td>
                <td className="py-2 pr-3 text-emerald-300">
                  {r.onboarding_state.replace(/_/g, " ")}
                </td>
                <td className="py-2 pr-3">
                  {r.has_public_key ? (
                    <span className="text-emerald-400">
                      ECDSA{r.require_asymmetric ? " · enforced" : ""}
                    </span>
                  ) : (
                    <button
                      type="button"
                      onClick={() => {
                        setPemFor(r.id);
                        setPem("");
                      }}
                      className="border border-zinc-700 px-2 py-0.5 text-[10px] uppercase tracking-[0.15em] text-zinc-400"
                    >
                      register pem
                    </button>
                  )}
                </td>
                <td className="py-2 pr-3 text-zinc-500">
                  {r.first_intent_at ? new Date(r.first_intent_at).toLocaleString() : "—"}
                </td>
                <td className="py-2 space-x-1">
                  {NEXT[r.onboarding_state] && (
                    <button
                      type="button"
                      disabled={mState.isPending}
                      onClick={() =>
                        mState.mutate({ id: r.id, state: NEXT[r.onboarding_state] as string })
                      }
                      className="border border-emerald-500/40 bg-emerald-500/10 px-2 py-0.5 text-[10px] uppercase tracking-[0.15em] text-emerald-300 disabled:opacity-40"
                    >
                      ▸ {NEXT[r.onboarding_state]?.replace(/_/g, " ")}
                    </button>
                  )}
                  <button
                    type="button"
                    disabled={mReveal.isPending}
                    onClick={() => mReveal.mutate({ id: r.id })}
                    className="border border-zinc-700 px-2 py-0.5 text-[10px] uppercase tracking-[0.15em] text-zinc-400 disabled:opacity-40"
                  >
                    creds
                  </button>
                </td>

              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={6} className="py-3 text-zinc-600">
                  No counterparties issued yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {creds && (
        <div className="mt-4 border border-emerald-500/40 bg-emerald-500/5 p-3">
          <div className="flex items-center justify-between">
            <div className="text-[10px] uppercase tracking-[0.2em] text-emerald-300">
              Onboarding credentials — {creds.label}
            </div>
            <button
              type="button"
              onClick={() => setCreds(null)}
              className="text-[10px] uppercase tracking-[0.15em] text-zinc-500"
            >
              close
            </button>
          </div>
          <pre className="mt-2 overflow-x-auto whitespace-pre-wrap break-all text-[11px] text-zinc-200">
{`X-M2M-Key-Id:  ${creds.key_id}
HMAC secret:   ${creds.hmac_secret ?? "(not provisioned)"}`}
          </pre>
          <button
            type="button"
            onClick={() => {
              navigator.clipboard.writeText(
                `X-M2M-Key-Id: ${creds.key_id}\nHMAC secret: ${creds.hmac_secret ?? ""}`,
              );
              toast.success("Credentials copied");
            }}
            className="mt-2 border border-zinc-700 px-2 py-0.5 text-[10px] uppercase tracking-[0.15em] text-zinc-300"
          >
            copy
          </button>
        </div>
      )}



      {pemFor && (
        <div className="mt-4 border border-zinc-800 bg-zinc-900/60 p-3">
          <div className="text-[10px] uppercase tracking-[0.2em] text-zinc-500">
            Counterparty public key (PEM · SPKI) — enforces ECDSA envelope signatures
          </div>
          <textarea
            value={pem}
            onChange={(e) => setPem(e.target.value)}
            rows={5}
            placeholder="-----BEGIN PUBLIC KEY-----"
            className="mt-2 w-full border border-zinc-700 bg-zinc-950 p-2 text-[11px] text-zinc-200"
          />
          <div className="mt-2 flex gap-2">
            <button
              type="button"
              disabled={!pem.trim() || mKey.isPending}
              onClick={() => mKey.mutate({ id: pemFor, pem: pem.trim() })}
              className="border border-emerald-500/40 bg-emerald-500/10 px-3 py-1 text-[10px] uppercase tracking-[0.2em] text-emerald-300 disabled:opacity-40"
            >
              register
            </button>
            <button
              type="button"
              onClick={() => setPemFor(null)}
              className="border border-zinc-700 px-3 py-1 text-[10px] uppercase tracking-[0.2em] text-zinc-400"
            >
              cancel
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
