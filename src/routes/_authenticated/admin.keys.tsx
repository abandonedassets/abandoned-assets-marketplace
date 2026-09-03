import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import {
  listApiKeys,
  createApiKey,
  revokeApiKey,
  listWaitlist,
  setBuyingPower,
} from "@/lib/admin-keys.functions";
import { Button } from "@/components/ui/button";
import { GatewayCredentials } from "@/components/admin/GatewayCredentials";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";

export const Route = createFileRoute("/_authenticated/admin/keys")({
  head: () => ({
    meta: [
      { title: "API Keys — Admin" },
      { name: "robots", content: "noindex,nofollow" },
    ],
  }),
  component: AdminKeysPage,
});

function AdminKeysPage() {
  const qc = useQueryClient();
  const list = useServerFn(listApiKeys);
  const create = useServerFn(createApiKey);
  const revoke = useServerFn(revokeApiKey);
  const waitlistFn = useServerFn(listWaitlist);

  const keys = useQuery({
    queryKey: ["admin-keys"],
    queryFn: () => list(),
  });

  const waitlist = useQuery({
    queryKey: ["admin-waitlist"],
    queryFn: () => waitlistFn(),
    refetchInterval: 30_000,
  });

  const activeCount = (keys.data ?? []).filter((k) => k.is_active).length;

  const [buyerName, setBuyerName] = useState("");
  const [rateLimit, setRateLimit] = useState(60);
  const [issued, setIssued] = useState<{
    label: string;
    raw_key: string;
  } | null>(null);

  const createMut = useMutation({
    mutationFn: (input: { buyer_name: string; rate_limit_per_minute: number }) =>
      create({ data: input }),
    onSuccess: (res) => {
      setIssued({ label: res.label, raw_key: res.raw_key });
      setBuyerName("");
      qc.invalidateQueries({ queryKey: ["admin-keys"] });
    },
  });

  const revokeMut = useMutation({
    mutationFn: (id: string) => revoke({ data: { id } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin-keys"] }),
  });

  // Destroy raw key from memory on unmount
  useEffect(() => () => setIssued(null), []);

  return (
    <main className="min-h-screen bg-background p-4 md:p-8">
      <div className="mx-auto max-w-5xl space-y-6">
        <header>
          <h1 className="font-mono text-sm uppercase tracking-widest text-muted-foreground">
            /admin/keys
          </h1>
          <p className="mt-1 text-2xl font-semibold text-foreground">
            Institutional API Keys
          </p>
        </header>

        <GatewayCredentials />



        <section className="grid grid-cols-2 gap-3">
          <div className="rounded-lg border border-border bg-card p-4">
            <div className="text-xs uppercase tracking-wider text-muted-foreground">
              Active Keys
            </div>
            <div className="mt-1 font-mono text-3xl font-semibold text-foreground">
              {keys.isLoading ? "—" : activeCount}
            </div>
            <div className="mt-1 text-xs text-muted-foreground">
              Funds inside the dark pool
            </div>
          </div>
          <div className="rounded-lg border border-border bg-card p-4">
            <div className="text-xs uppercase tracking-wider text-muted-foreground">
              Waitlisted Funds
            </div>
            <div className="mt-1 font-mono text-3xl font-semibold text-amber-500">
              {waitlist.isLoading ? "—" : (waitlist.data?.pending_count ?? 0)}
            </div>
            <div className="mt-1 text-xs text-muted-foreground">
              Requesting allocation
            </div>
          </div>
        </section>



        <section className="rounded-lg border border-border bg-card p-4 md:p-6">
          <h2 className="text-sm font-medium text-foreground">
            Provision new buyer
          </h2>
          <form
            className="mt-3 flex flex-col gap-3 md:flex-row md:items-end"
            onSubmit={(e) => {
              e.preventDefault();
              if (!buyerName.trim()) return;
              createMut.mutate({
                buyer_name: buyerName.trim(),
                rate_limit_per_minute: rateLimit,
              });
            }}
          >
            <div className="flex-1">
              <label className="text-xs text-muted-foreground">
                Buyer name
              </label>
              <Input
                value={buyerName}
                onChange={(e) => setBuyerName(e.target.value)}
                placeholder="Acme Capital Partners"
                required
                maxLength={200}
              />
            </div>
            <div className="w-full md:w-40">
              <label className="text-xs text-muted-foreground">
                Rate / min
              </label>
              <Input
                type="number"
                min={1}
                max={10000}
                value={rateLimit}
                onChange={(e) =>
                  setRateLimit(parseInt(e.target.value || "60", 10))
                }
              />
            </div>
            <Button type="submit" disabled={createMut.isPending}>
              {createMut.isPending ? "Generating…" : "Generate Access Token"}
            </Button>
          </form>
          {createMut.error && (
            <p className="mt-2 text-sm text-destructive">
              {(createMut.error as Error).message}
            </p>
          )}
        </section>

        <section className="rounded-lg border border-border bg-card">
          <div className="border-b border-border p-4">
            <h2 className="text-sm font-medium text-foreground">Active keys</h2>
          </div>
          {keys.isLoading ? (
            <div className="p-4 text-sm text-muted-foreground">Loading…</div>
          ) : keys.error ? (
            <div className="p-4 text-sm text-destructive">
              {(keys.error as Error).message}
            </div>
          ) : (keys.data ?? []).length === 0 ? (
            <div className="p-4 text-sm text-muted-foreground">
              No keys yet.
            </div>
          ) : (
            <div className="divide-y divide-border">
              {keys.data!.map((k) => (
                <KeyRow
                  key={k.id}
                  k={k}
                  onRevoke={(id) => {
                    if (confirm(`Revoke key for ${k.label}?`))
                      revokeMut.mutate(id);
                  }}
                />
              ))}
            </div>
          )}
        </section>

        <section className="rounded-lg border border-border bg-card">
          <div className="border-b border-border p-4">
            <h2 className="text-sm font-medium text-foreground">
              Waitlist · reverse-inquiry
            </h2>
            <p className="mt-1 text-xs text-muted-foreground">
              Funds that hit <code>POST /api/public/request-key</code> queue up here.
            </p>
          </div>
          {waitlist.isLoading ? (
            <div className="p-4 text-sm text-muted-foreground">Loading…</div>
          ) : (waitlist.data?.rows ?? []).length === 0 ? (
            <div className="p-4 text-sm text-muted-foreground">
              No waitlist requests yet.
            </div>
          ) : (
            <div className="divide-y divide-border">
              {waitlist.data!.rows.map((w) => (
                <div key={w.id} className="p-4">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <div className="font-medium text-foreground">
                      {w.fund_name}
                    </div>
                    <div className="font-mono text-xs text-muted-foreground">
                      {new Date(w.created_at).toLocaleString()}
                    </div>
                  </div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    {w.aum_bracket ?? "AUM n/a"}
                    {w.contact_email ? ` · ${w.contact_email}` : ""}
                    {w.target_zips.length
                      ? ` · zips: ${w.target_zips.join(", ")}`
                      : ""}
                    {` · ${w.status}`}
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>


      <Dialog
        open={!!issued}
        onOpenChange={(open) => !open && setIssued(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Copy this key now</DialogTitle>
            <DialogDescription>
              This raw token will NEVER be shown again. Store it in your secrets
              manager and share it with {issued?.label} over a secure channel.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <pre className="overflow-x-auto rounded-md border border-border bg-muted p-3 font-mono text-xs">
              {issued?.raw_key}
            </pre>
            <div className="flex gap-2">
              <Button
                onClick={() => {
                  if (issued) navigator.clipboard.writeText(issued.raw_key);
                }}
              >
                Copy to clipboard
              </Button>
              <Button variant="outline" onClick={() => setIssued(null)}>
                I've saved it
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </main>
  );
}

function formatUsdCompact(n: number | null): string {
  if (n == null || n <= 0) return "—";
  if (n >= 1_000_000_000) return `$${(n / 1_000_000_000).toFixed(2)}B`;
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  return `$${n.toLocaleString()}`;
}

type AdminKey = {
  id: string;
  label: string;
  key_prefix: string;
  rate_limit_per_minute: number;
  is_active: boolean;
  created_at: string;
  last_used_at: string | null;
  declared_buying_power_usd: number | null;
};

function KeyRow({
  k,
  onRevoke,
}: {
  k: AdminKey;
  onRevoke: (id: string) => void;
}) {
  const qc = useQueryClient();
  const setBp = useServerFn(setBuyingPower);
  const [editing, setEditing] = useState(false);
  const [bpInput, setBpInput] = useState(
    k.declared_buying_power_usd != null
      ? String(k.declared_buying_power_usd / 1_000_000)
      : "",
  );
  const bpMut = useMutation({
    mutationFn: (millions: number | null) =>
      setBp({
        data: {
          id: k.id,
          declared_buying_power_usd:
            millions == null ? null : Math.floor(millions * 1_000_000),
        },
      }),
    onSuccess: () => {
      setEditing(false);
      qc.invalidateQueries({ queryKey: ["admin-keys"] });
    },
  });
  return (
    <div className="flex flex-col gap-2 p-4 md:flex-row md:items-center md:justify-between">
      <div className="min-w-0">
        <div className="font-medium text-foreground">{k.label}</div>
        <div className="font-mono text-xs text-muted-foreground">
          {k.key_prefix}… · {k.rate_limit_per_minute}/min · created{" "}
          {new Date(k.created_at).toLocaleDateString()}
          {k.last_used_at
            ? ` · last used ${new Date(k.last_used_at).toLocaleString()}`
            : " · never used"}
        </div>
        <div className="mt-1 flex items-center gap-2 text-xs">
          <span className="text-muted-foreground">Declared buying power:</span>
          {editing ? (
            <>
              <Input
                className="h-7 w-24"
                type="number"
                min={0}
                step={1}
                value={bpInput}
                onChange={(e) => setBpInput(e.target.value)}
                placeholder="M"
              />
              <span className="text-muted-foreground">M USD</span>
              <Button
                size="sm"
                variant="outline"
                onClick={() =>
                  bpMut.mutate(bpInput === "" ? null : parseFloat(bpInput))
                }
                disabled={bpMut.isPending}
              >
                Save
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  setEditing(false);
                  setBpInput(
                    k.declared_buying_power_usd != null
                      ? String(k.declared_buying_power_usd / 1_000_000)
                      : "",
                  );
                }}
              >
                Cancel
              </Button>
            </>
          ) : (
            <>
              <span className="font-mono text-foreground">
                {formatUsdCompact(k.declared_buying_power_usd)}
              </span>
              <Button
                size="sm"
                variant="ghost"
                className="h-6 px-2 text-xs"
                onClick={() => setEditing(true)}
              >
                Edit
              </Button>
            </>
          )}
        </div>
      </div>
      <div className="flex items-center gap-2">
        <span
          className={`rounded-full px-2 py-0.5 text-xs ${
            k.is_active
              ? "bg-emerald-500/10 text-emerald-600"
              : "bg-muted text-muted-foreground"
          }`}
        >
          {k.is_active ? "active" : "revoked"}
        </span>
        {k.is_active && (
          <Button variant="outline" size="sm" onClick={() => onRevoke(k.id)}>
            Revoke
          </Button>
        )}
      </div>
    </div>
  );
}
