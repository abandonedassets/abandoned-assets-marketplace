import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { getSettlementFeed, getWireSignals, type WireSignal } from "@/lib/settlement-feed.functions";
import { getInboundProbes } from "@/lib/m2m-observability.functions";
import {
  SYNTHETIC_SOCKET_EVENT,
  type SyntheticSettlementEvent,
} from "@/lib/synthetic-socket";
import { wireEta } from "@/lib/wire-eta";

const fmt = (n: number) => `$${Math.round(n).toLocaleString()}`;

function RawWebhookConsole() {
  const fetchProbes = useServerFn(getInboundProbes);
  const q = useQuery({
    queryKey: ["m2m", "inbound-probes"],
    queryFn: () => fetchProbes({ data: undefined as never }),
    retry: false,
  });
  const rows = q.data ?? [];

  return (
    <div className="mt-3 max-h-72 overflow-auto rounded border border-border bg-background/60 p-2 font-mono text-[10px]">
      {rows.length === 0 ? (
        <p className="text-muted-foreground">
          No inbound probes logged. Nothing has hit /api/v1/m2m/accept or /api/m2m/execute yet.
        </p>
      ) : (
        rows.map((r) => (
          <div key={r.id} className="border-b border-border/40 py-1">
            <div className="flex flex-wrap gap-x-2">
              <span className="text-muted-foreground">
                {new Date(r.received_at).toISOString().replace("T", " ").slice(0, 19)}
              </span>
              <span className={r.authorized ? "text-emerald-500" : "text-destructive"}>
                {r.method} {r.endpoint} → {r.http_status ?? "—"}
              </span>
              <span className="text-muted-foreground">
                {r.latency_ms != null ? `${r.latency_ms}ms` : ""} {r.ip ?? ""}
              </span>
              <span>{r.box_label ?? (r.api_key_prefix ? `key ${r.api_key_prefix}…` : "no key")}</span>
            </div>
            {r.body_preview && (
              <pre className="mt-0.5 whitespace-pre-wrap break-all text-muted-foreground">
                {r.body_preview}
              </pre>
            )}
            {r.headers && (
              <pre className="whitespace-pre-wrap break-all text-muted-foreground/70">
                {JSON.stringify(r.headers)}
              </pre>
            )}
          </div>
        ))
      )}
    </div>
  );
}

function SyntheticRow({ e }: { e: SyntheticSettlementEvent }) {
  const eta = wireEta(e.entered_at);
  return (
    <li className="animate-pulse rounded-md border border-violet-500/60 bg-violet-500/10 p-3">
      <div className="flex items-center justify-between gap-2">
        <span className="font-mono text-[10px] uppercase tracking-widest text-violet-400">
          synthetic diagnostic event (frontend only)
        </span>
        <span className="rounded-full border border-violet-500/60 bg-violet-500/20 px-2 py-0.5 font-mono text-[10px] font-bold text-violet-300">
          FEES IN TRANSIT
        </span>
      </div>
      <div className="mt-1 truncate text-sm font-medium">
        {e.address} · {e.zip}
      </div>
      <div className="mt-0.5 grid grid-cols-2 gap-x-3 font-mono text-[11px] text-muted-foreground">
        <span>MEMO {e.memo_id}</span>
        <span>BUYER {e.buyer_name}</span>
        <span className="text-emerald-500">FEE {fmt(e.fee_usd)}</span>
        <span>ETA TO BLUEVINE · {eta.label}</span>
      </div>
    </li>
  );
}

function countdown(iso: string | null, now: number): string {
  if (!iso) return "—";
  const ms = Date.parse(iso) - now;
  if (!isFinite(ms)) return "—";
  if (ms <= 0) return "WINDOW ELAPSED";
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  const s = Math.floor((ms % 60_000) / 1000);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function WireSignalRow({ w, now }: { w: WireSignal; now: number }) {
  return (
    <li className="rounded-md border border-emerald-400/60 bg-emerald-500/10 p-3 shadow-[0_0_12px_rgba(16,185,129,0.35)]">
      <div className="flex items-center justify-between gap-2">
        <span className="font-mono text-[10px] uppercase tracking-widest text-emerald-400">
          wire instructed
        </span>
        <span className="rounded-full border border-emerald-400/70 bg-emerald-500/20 px-2 py-0.5 font-mono text-[10px] font-bold text-emerald-300">
          24H LOCK ACTIVE · {countdown(w.expires_at, now)}
        </span>
      </div>
      <div className="mt-1 truncate text-sm font-medium">
        {w.address || "—"} · {w.zip || "—"}
      </div>
      <div className="mt-0.5 grid grid-cols-2 gap-x-3 font-mono text-[11px] text-muted-foreground">
        <span>DEAL {w.memo_id}</span>
        <span>RAIL {w.rail}</span>
        <span className="text-emerald-500">LOCK VALUE {fmt(w.amount_usd)}</span>
        <span>{new Date(w.wire_instructed_at).toLocaleString()}</span>
      </div>
    </li>
  );
}

export function LiveSettlementFeed() {
  const [showRaw, setShowRaw] = useState(false);
  const [synthetic, setSynthetic] = useState<SyntheticSettlementEvent[]>([]);

  useEffect(() => {
    const handler = (ev: Event) => {
      const detail = (ev as CustomEvent<SyntheticSettlementEvent>).detail;
      setSynthetic((prev) => [detail, ...prev].slice(0, 5));
    };
    window.addEventListener(SYNTHETIC_SOCKET_EVENT, handler);
    return () => window.removeEventListener(SYNTHETIC_SOCKET_EVENT, handler);
  }, []);
  const fetchFeed = useServerFn(getSettlementFeed);
  const feed = useQuery({
    queryKey: ["mt", "settlement-feed"],
    queryFn: () => fetchFeed(),
    retry: false,
  });

  const fetchWires = useServerFn(getWireSignals);
  const wires = useQuery({
    queryKey: ["mt", "wire-signals"],
    queryFn: () => fetchWires({ data: undefined as never }),
    refetchInterval: 15_000,
    retry: false,
  });
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const rows = feed.data ?? [];
  const wireRows = wires.data ?? [];

  return (
    <section className="rounded-lg border bg-card p-4">
      <div className="flex items-baseline justify-between">
        <h2 className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
          live settlement feed
        </h2>
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => setShowRaw((v) => !v)}
            className="rounded border border-border px-2 py-0.5 font-mono text-[10px] uppercase tracking-widest text-muted-foreground hover:text-foreground"
          >
            {showRaw ? "hide raw log" : "raw webhook log"}
          </button>
          <span className="font-mono text-[10px] text-emerald-500">● AUTO-CLEARING</span>
        </div>
      </div>

      {showRaw && <RawWebhookConsole />}

      {synthetic.length > 0 && (
        <ul className="mt-3 space-y-2">
          {synthetic.map((e) => (
            <SyntheticRow key={e.id} e={e} />
          ))}
        </ul>
      )}


      {wireRows.length > 0 && (
        <ul className="mt-3 space-y-2">
          {wireRows.map((w) => (
            <WireSignalRow key={w.id} w={w} now={now} />
          ))}
        </ul>
      )}

      {rows.length === 0 && wireRows.length === 0 ? (
        <p className="mt-3 text-xs text-muted-foreground">
          No auto-cleared settlements yet. Confirmed wires clear automatically — no clicks required.
        </p>
      ) : rows.length === 0 ? null : (
        <ul className="mt-3 space-y-2">
          {rows.map((r) => (
            <li
              key={r.id}
              className="rounded-md border border-emerald-500/40 bg-emerald-500/10 p-3"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="font-mono text-[10px] uppercase tracking-widest text-emerald-500">
                  automated settlement confirmed
                </span>
                <span
                  className={`rounded-full border px-2 py-0.5 font-mono text-[10px] ${
                    r.cleared
                      ? "border-emerald-500/50 text-emerald-400"
                      : "border-amber-500/50 text-amber-400"
                  }`}
                >
                  {r.cleared ? "FUNDS CLEARED" : `WIRED • ${r.days_to_deposit} DAYS TO DEPOSIT`}
                </span>
              </div>
              <div className="mt-1 truncate text-sm font-medium">
                {r.address || "—"} · {r.zip || "—"}
              </div>
              <div className="mt-0.5 grid grid-cols-2 gap-x-3 font-mono text-[11px] text-muted-foreground">
                <span>MEMO {r.memo_id}</span>
                <span>BUYER {r.buyer_name ?? "—"}</span>
                <span className="text-emerald-500">FEE {fmt(r.fee_usd)}</span>
                <span>{new Date(r.settled_at).toLocaleString()}</span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
