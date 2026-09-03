import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  getBluevineConfig,
  saveBluevineConfig,
  testBluevineConnection,
  clearBluevineConfig,
  getAutoReleaseStatus,
} from "@/lib/banking.functions";
import { getPlaidStatus } from "@/lib/plaid.functions";

export function GatewayConnector() {
  const qc = useQueryClient();
  const cfg = useServerFn(getBluevineConfig);
  const save = useServerFn(saveBluevineConfig);
  const ping = useServerFn(testBluevineConnection);
  const clear = useServerFn(clearBluevineConfig);
  const release = useServerFn(getAutoReleaseStatus);
  const plaid = useServerFn(getPlaidStatus);

  const [base, setBase] = useState("");
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const c = useQuery({ queryKey: ["bluevine-config"], queryFn: () => cfg(), retry: false });
  const p = useQuery({ queryKey: ["plaid-status"], queryFn: () => plaid(), retry: false });
  const probe = useQuery({
    queryKey: ["bluevine-ping"],
    queryFn: () => ping(),
    retry: false,
    refetchInterval: 120_000,
  });

  const rel = useQuery({
    queryKey: ["auto-release-status"],
    queryFn: () => release(),
    retry: false,
    refetchInterval: 15_000,
  });

  const d: any = c.data ?? {};
  const pd: any = p.data ?? {};
  const pr: any = probe.data ?? {};
  const rd: any = rel.data ?? {};
  const autonomous = Boolean(rd.handshake && !rd.block_active);
  const green = Boolean(pd.linked && pr.ok);

  async function onSave() {
    setBusy(true);
    setMsg(null);
    try {
      const out: any = await save({ data: { base, key } });
      if (!out?.ok) setMsg(`Save failed: ${out?.error ?? "unknown"}`);
      else
        setMsg(
          out.ping?.ok
            ? "Credentials saved — Bluevine authenticated."
            : `Saved, but the live ping failed: ${out.ping?.detail ?? "unknown"}`,
        );
      setKey("");
      qc.invalidateQueries({ queryKey: ["bluevine-config"] });
      qc.invalidateQueries({ queryKey: ["bluevine-ping"] });
      qc.invalidateQueries({ queryKey: ["rail-diagnostics"] });
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="border-border bg-card rounded-lg border p-5">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-sm font-semibold tracking-wide uppercase">Bank &amp; Gateway Connector</h2>
        <span
          className={`rounded-full px-3 py-1 text-[11px] font-bold tracking-wide uppercase ${
            green ? "bg-emerald-500/15 text-emerald-500" : "bg-amber-500/15 text-amber-500"
          }`}
        >
          {green ? "● HANDSHAKE LIVE" : "● HANDSHAKE INCOMPLETE"}
        </span>
      </div>

      <div className="mb-5 grid grid-cols-2 gap-4 text-sm md:grid-cols-4">
        <Cell label="Plaid item" ok={Boolean(pd.linked)} value={pd.linked ? "LINKED" : "NO ROWS"} />
        <Cell label="Bluevine creds" ok={Boolean(d.bound)} value={d.bound ? `SET (${d.source})` : "MISSING"} />
        <Cell label="Auth ping" ok={Boolean(pr.ok)} value={pr.ok ? "AUTHENTICATED" : String(pr.detail ?? "—")} />
        <Cell label="Key" ok={Boolean(d.key_last4)} value={d.key_last4 ? `••••${d.key_last4}` : "—"} />
      </div>

      <div className="mb-5 grid grid-cols-2 gap-4 text-sm md:grid-cols-4">
        <Cell label="Safety lock" ok={!rd.block_active} value={rd.block_active ? "ENGAGED" : "LIFTED"} />
        <Cell label="Rails" ok={Boolean(rd.rails_live)} value={rd.rails_live ? "LIVE" : "BLOCKED"} />
        <Cell
          label="Released this cycle"
          ok={Number(rd.released ?? 0) >= 0}
          value={String(rd.released ?? 0)}
        />
        <Cell
          label="Last check"
          ok={Boolean(rd.checked_at)}
          value={rd.checked_at ? new Date(rd.checked_at).toLocaleTimeString() : "—"}
        />
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <label className="text-xs">
          <span className="text-muted-foreground">BLUEVINE_API_BASE</span>
          <input
            value={base}
            onChange={(e) => setBase(e.target.value)}
            placeholder={d.base ?? "https://api.bluevine.com"}
            className="border-border bg-background mt-1 w-full rounded-md border px-3 py-2 font-mono text-xs"
          />
        </label>
        <label className="text-xs">
          <span className="text-muted-foreground">BLUEVINE_API_KEY</span>
          <input
            value={key}
            onChange={(e) => setKey(e.target.value)}
            type="password"
            autoComplete="off"
            placeholder="••••••••"
            className="border-border bg-background mt-1 w-full rounded-md border px-3 py-2 font-mono text-xs"
          />
        </label>
      </div>

      <div className="mt-4 flex flex-wrap gap-3">
        <button
          onClick={onSave}
          disabled={busy || !base || !key}
          className="bg-primary text-primary-foreground rounded-md px-4 py-2 text-sm font-semibold disabled:opacity-50"
        >
          Save &amp; Test Connection
        </button>
        <button
          onClick={() => {
            probe.refetch();
            c.refetch();
          }}
          className="border-border rounded-md border px-4 py-2 text-sm"
        >
          Re-test
        </button>
        <span
          className={`rounded-md px-4 py-2 text-sm font-semibold ${
            autonomous
              ? "bg-emerald-500/15 text-emerald-500"
              : "bg-amber-500/15 text-amber-500"
          }`}
        >
          {autonomous
            ? "● AUTONOMOUS TRANSIT ACTIVE"
            : `○ AWAITING RAILS${rd.reason ? ` — ${rd.reason}` : ""}`}
        </span>
        {d.bound && d.source === "config" ? (
          <button
            onClick={async () => {
              await clear();
              qc.invalidateQueries({ queryKey: ["bluevine-config"] });
              qc.invalidateQueries({ queryKey: ["bluevine-ping"] });
            }}
            className="text-muted-foreground rounded-md px-4 py-2 text-sm"
          >
            Remove
          </button>
        ) : null}
      </div>

      {msg ? <p className="text-muted-foreground mt-3 text-xs">{msg}</p> : null}
    </section>
  );
}

function Cell({ label, value, ok }: { label: string; value: string; ok: boolean }) {
  return (
    <div>
      <p className="text-muted-foreground text-[11px] tracking-wide uppercase">{label}</p>
      <p className={`text-sm font-semibold ${ok ? "text-emerald-500" : "text-amber-500"}`}>{value}</p>
    </div>
  );
}
