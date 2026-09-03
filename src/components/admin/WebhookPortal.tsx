import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  listEndpoints,
  registerEndpoint,
  toggleEndpoint,
  testPingEndpoint,
} from "@/lib/webhooks.functions";

/** Institutional Webhook Portal — algorithmic / hedge-fund ingest endpoints. */
export function WebhookPortal() {
  const listFn = useServerFn(listEndpoints);
  const addFn = useServerFn(registerEndpoint);
  const toggleFn = useServerFn(toggleEndpoint);
  const pingFn = useServerFn(testPingEndpoint);
  const qc = useQueryClient();

  const [name, setName] = useState("");
  const [url, setUrl] = useState("");

  const { data: endpoints, isLoading } = useQuery({
    queryKey: ["routing-endpoints"],
    queryFn: () => listFn(),
    refetchInterval: 60_000,
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: ["routing-endpoints"] });

  const add = useMutation({
    mutationFn: () => addFn({ data: { name, url } }),
    onSuccess: () => {
      toast.success("Ingest endpoint registered");
      setName("");
      setUrl("");
      invalidate();
    },
    onError: (e: Error) => toast.error(`Register failed :: ${e.message}`),
  });

  const toggle = useMutation({
    mutationFn: (v: { id: string; is_active: boolean }) => toggleFn({ data: v }),
    onSuccess: invalidate,
    onError: (e: Error) => toast.error(e.message),
  });

  const ping = useMutation({
    mutationFn: (id: string) => pingFn({ data: { id } }),
    onSuccess: (r) =>
      r.ok
        ? toast.success(`Ping 200 · ${r.status} · ${r.latency_ms}ms`)
        : toast.error(`Ping failed · ${r.status || "no response"} · ${r.latency_ms}ms`),
    onError: (e: Error) => toast.error(`Ping error :: ${e.message}`),
  });

  return (
    <div className="border border-zinc-800 bg-[#0B0E14] font-mono">
      <div className="border-b border-zinc-800 px-4 py-3">
        <h2 className="text-sm font-bold text-cyan-400">INSTITUTIONAL WEBHOOK PORTAL</h2>
        <p className="text-[10px] uppercase tracking-[0.2em] text-zinc-500">
          algorithmic / hedge-fund ingest endpoints
        </p>
      </div>

      <div className="grid gap-2 border-b border-zinc-800 p-4 md:grid-cols-[1fr_2fr_auto]">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Fund label"
          maxLength={100}
          className="h-10 border border-zinc-700 bg-zinc-900/60 px-3 text-xs text-zinc-100 outline-none focus:border-cyan-500/60"
        />
        <input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://fund.example.com/ingest"
          maxLength={500}
          className="h-10 border border-zinc-700 bg-zinc-900/60 px-3 text-xs text-zinc-100 outline-none focus:border-cyan-500/60"
        />
        <button
          type="button"
          disabled={add.isPending || !name.trim() || !url.trim()}
          onClick={() => add.mutate()}
          className="h-10 border border-cyan-500/50 bg-cyan-500/10 px-4 text-[10px] font-bold uppercase tracking-[0.15em] text-cyan-300 transition hover:bg-cyan-500/20 disabled:opacity-30"
        >
          Register Ingest URL
        </button>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead className="bg-zinc-900/60 text-[10px] uppercase tracking-wider text-zinc-500">
            <tr className="text-left">
              <th className="px-3 py-2 font-normal">Fund</th>
              <th className="px-3 py-2 font-normal">Endpoint</th>
              <th className="px-3 py-2 font-normal">State</th>
              <th className="px-3 py-2 font-normal">Last Dispatch</th>
              <th className="px-3 py-2 text-right font-normal">Actions</th>
            </tr>
          </thead>
          <tbody>
            {isLoading && <tr><td colSpan={5} className="px-3 py-6 text-zinc-500">loading…</td></tr>}
            {!isLoading && (endpoints ?? []).length === 0 && (
              <tr><td colSpan={5} className="px-3 py-6 text-zinc-500">NO ENDPOINTS REGISTERED</td></tr>
            )}
            {(endpoints ?? []).map((e) => (
              <tr key={e.id} className="border-t border-zinc-900">
                <td className="px-3 py-2 text-zinc-100">{e.name}</td>
                <td className="max-w-[320px] truncate px-3 py-2 text-zinc-400">{e.url}</td>
                <td className="px-3 py-2">
                  <span
                    className={`border px-1.5 py-0.5 text-[10px] uppercase tracking-wider ${
                      e.is_active
                        ? "border-emerald-500/40 bg-emerald-500/5 text-emerald-400"
                        : "border-zinc-700 text-zinc-500"
                    }`}
                  >
                    {e.is_active ? "active" : "paused"}
                  </span>
                </td>
                <td className="px-3 py-2 text-zinc-500">
                  {e.last_dispatched_at ? new Date(e.last_dispatched_at).toISOString().slice(0, 16).replace("T", " ") : "—"}
                </td>
                <td className="space-x-1 whitespace-nowrap px-3 py-2 text-right">
                  <button
                    type="button"
                    disabled={ping.isPending}
                    onClick={() => ping.mutate(e.id)}
                    className="border border-cyan-500/40 bg-cyan-500/10 px-2 py-0.5 text-[10px] uppercase tracking-[0.15em] text-cyan-300 transition hover:bg-cyan-500/20 disabled:opacity-30"
                  >
                    ▸ test ping
                  </button>
                  <button
                    type="button"
                    onClick={() => toggle.mutate({ id: e.id, is_active: !e.is_active })}
                    className="border border-zinc-600 bg-zinc-800/40 px-2 py-0.5 text-[10px] uppercase tracking-[0.15em] text-zinc-300 transition hover:bg-zinc-700/40"
                  >
                    {e.is_active ? "pause" : "resume"}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
