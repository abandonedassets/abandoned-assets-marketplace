import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import {
  listMarketplaceDeals,
  registerMarketplaceBuyer,
  getMarketplaceVdr,
  lockDealAndSubmitEmd,
  type MarketplaceDeal,
} from "@/lib/marketplace.functions";

export const Route = createFileRoute("/marketplace")({
  head: () => ({
    meta: [
      { title: "Off-Market Deal Marketplace — Live VDR & 1-Click EMD" },
      {
        name: "description",
        content:
          "Live off-market asset tape: ARV discounts, title purity scores, FEMA clearance and one-click $1,000 EMD lock for verified cash buyers.",
      },
      { property: "og:title", content: "Off-Market Deal Marketplace — Live VDR" },
      {
        property: "og:description",
        content: "Inspect data decks and lock contracts with a $1,000 EMD in one click.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: MarketplacePage,
});

const usd = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

const TOKEN_KEY = "aa_buyer_token";

function MarketplacePage() {
  const list = useServerFn(listMarketplaceDeals);
  const register = useServerFn(registerMarketplaceBuyer);
  const vdrFn = useServerFn(getMarketplaceVdr);
  const lockFn = useServerFn(lockDealAndSubmitEmd);

  const [buyerToken, setBuyerToken] = useState<string | null>(null);
  const [zip, setZip] = useState("");
  const [assetType, setAssetType] = useState("");
  const [minDiscount, setMinDiscount] = useState(0);
  const [open, setOpen] = useState<MarketplaceDeal | null>(null);
  const [vdr, setVdr] = useState<Record<string, any> | null>(null);
  const [locking, setLocking] = useState(false);
  const [lockMsg, setLockMsg] = useState<string | null>(null);
  const [showReg, setShowReg] = useState(false);

  useEffect(() => {
    setBuyerToken(localStorage.getItem(TOKEN_KEY));
  }, []);

  const { data: deals = [], isLoading } = useQuery({
    queryKey: ["marketplace", zip, assetType, minDiscount, buyerToken],
    queryFn: () =>
      list({
        data: {
          zip: zip.trim().length === 5 ? zip.trim() : undefined,
          assetType: assetType || undefined,
          minDiscount: minDiscount || undefined,
          buyerToken: buyerToken ?? undefined,
        },
      }),
    refetchInterval: 30000,
  });

  const types = useMemo(
    () => Array.from(new Set(deals.map((d) => d.asset_type).filter(Boolean))) as string[],
    [deals],
  );

  async function openVdr(d: MarketplaceDeal) {
    setOpen(d);
    setVdr(null);
    setLockMsg(null);
    const pkg = await vdrFn({ data: { dealId: d.id, buyerToken: buyerToken ?? undefined } });
    setVdr(pkg as any);
  }

  async function doLock() {
    if (!open) return;
    if (!buyerToken) {
      setShowReg(true);
      return;
    }
    setLocking(true);
    setLockMsg(null);
    try {
      const res: any = await lockFn({
        data: { dealId: open.id, buyerToken, origin: window.location.origin },
      });
      if (res?.ok && res.url) window.location.href = res.url;
      else setLockMsg(res?.error ?? "Lock failed — contact desk.");
    } catch (e) {
      setLockMsg(e instanceof Error ? e.message : "Lock failed");
    } finally {
      setLocking(false);
    }
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="border-b border-border/60 px-5 py-6">
        <h1 className="font-mono text-xl font-bold tracking-tight">
          OFF-MARKET ASSET TAPE
        </h1>
        <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
          Live contracts assigned by ReelEdge Entertainment LLC. Inspect the data room, lock the
          asset with a $1,000 EMD, close via ACH.
        </p>
        <div className="mt-3 flex items-center gap-3 text-xs font-mono">
          <span className="rounded border border-emerald-500/40 bg-emerald-500/10 px-2 py-0.5 text-emerald-400">
            {deals.length} LIVE
          </span>
          {buyerToken ? (
            <span className="text-emerald-400">VERIFIED BUYER — addresses unlocked</span>
          ) : (
            <button
              onClick={() => setShowReg(true)}
              className="rounded border border-primary/50 px-2 py-0.5 text-primary hover:bg-primary/10"
            >
              REGISTER TO UNLOCK ADDRESSES
            </button>
          )}
        </div>
      </header>

      <section className="flex flex-wrap gap-3 border-b border-border/60 px-5 py-3">
        <input
          value={zip}
          onChange={(e) => setZip(e.target.value.replace(/\D/g, "").slice(0, 5))}
          placeholder="ZIP"
          className="w-28 rounded border border-border bg-card px-2 py-1 font-mono text-sm"
        />
        <select
          value={assetType}
          onChange={(e) => setAssetType(e.target.value)}
          className="rounded border border-border bg-card px-2 py-1 font-mono text-sm"
        >
          <option value="">ALL TYPES</option>
          {types.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
        <label className="flex items-center gap-2 font-mono text-xs text-muted-foreground">
          MIN ARV DISCOUNT {minDiscount}%
          <input
            type="range"
            min={0}
            max={70}
            step={5}
            value={minDiscount}
            onChange={(e) => setMinDiscount(Number(e.target.value))}
          />
        </label>
      </section>

      <main className="grid gap-3 p-5 sm:grid-cols-2 lg:grid-cols-3">
        {isLoading && <p className="font-mono text-sm text-muted-foreground">Streaming tape…</p>}
        {!isLoading && deals.length === 0 && (
          <p className="font-mono text-sm text-muted-foreground">No assets match this filter.</p>
        )}
        {deals.map((d) => (
          <button
            key={d.id}
            onClick={() => openVdr(d)}
            className="rounded border border-border bg-card p-4 text-left transition hover:border-primary/60"
          >
            <div className="flex items-baseline justify-between font-mono text-xs text-muted-foreground">
              <span>
                {d.city ?? "—"}, {d.state ?? "—"} {d.zip}
              </span>
              <span>{d.asset_type ?? "ASSET"}</span>
            </div>
            <div className="mt-1 font-mono text-sm">
              {d.street ?? "Address disclosed to verified buyers"}
            </div>
            <div className="mt-3 grid grid-cols-2 gap-2 font-mono text-sm">
              <Metric label="ARV" value={usd.format(d.arv)} />
              <Metric label="OFFER" value={usd.format(d.offer_price)} />
              <Metric label="DISCOUNT" value={`${d.discount_pct}%`} accent />
              <Metric label="TITLE PURITY" value={`${d.title_purity_score}/100`} />
              <Metric label="FEMA" value={d.fema_zone_clear ? "CLEAR" : "FLAG"} />
              <Metric label="POST-SALE TAX" value={usd.format(d.projected_post_sale_tax)} />
            </div>
          </button>
        ))}
      </main>

      {open && (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/70 p-4">
          <div className="w-full max-w-2xl rounded border border-border bg-card p-5">
            <div className="flex items-start justify-between">
              <h2 className="font-mono text-lg font-bold">VIRTUAL DATA ROOM</h2>
              <button
                onClick={() => setOpen(null)}
                className="font-mono text-sm text-muted-foreground hover:text-foreground"
              >
                CLOSE ✕
              </button>
            </div>
            <div className="mt-3 grid grid-cols-2 gap-2 font-mono text-sm sm:grid-cols-3">
              <Metric label="ARV" value={usd.format(open.arv)} />
              <Metric label="OFFER" value={usd.format(open.offer_price)} />
              <Metric label="DISCOUNT" value={`${open.discount_pct}%`} accent />
              <Metric label="TITLE PURITY" value={`${open.title_purity_score}/100`} />
              <Metric label="FEMA" value={open.fema_zone_clear ? "CLEAR" : "FLAG"} />
              <Metric label="POST-SALE TAX" value={usd.format(open.projected_post_sale_tax)} />
            </div>
            <pre className="mt-4 max-h-72 overflow-auto rounded bg-muted/40 p-3 font-mono text-[11px] leading-relaxed">
              {vdr ? JSON.stringify(vdr, null, 2) : "Loading data room…"}
            </pre>
            {lockMsg && <p className="mt-3 font-mono text-xs text-destructive">{lockMsg}</p>}
            <button
              onClick={doLock}
              disabled={locking}
              className="mt-4 w-full rounded bg-primary px-4 py-3 font-mono text-sm font-bold text-primary-foreground disabled:opacity-50"
            >
              {locking ? "LOCKING…" : "▸ LOCK & SUBMIT $1,000 EMD"}
            </button>
            <p className="mt-2 font-mono text-[10px] text-muted-foreground">
              EMD is non-refundable on default. Settlement is ACH-only. Anti-circumvention
              liquidated damages: $25,000.
            </p>
          </div>
        </div>
      )}

      {showReg && (
        <RegisterModal
          onClose={() => setShowReg(false)}
          onDone={(t) => {
            localStorage.setItem(TOKEN_KEY, t);
            setBuyerToken(t);
            setShowReg(false);
          }}
          submit={register as any}
        />
      )}
    </div>
  );
}

function Metric({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className={accent ? "text-emerald-400" : ""}>{value}</div>
    </div>
  );
}

function RegisterModal({
  onClose,
  onDone,
  submit,
}: {
  onClose: () => void;
  onDone: (token: string) => void;
  submit: (a: { data: Record<string, string> }) => Promise<any>;
}) {
  const [form, setForm] = useState({
    name: "",
    entity: "",
    email: "",
    phone: "",
    proof_of_funds: "",
  });
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function go(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      const res = await submit({ data: form });
      if (res?.ok) onDone(res.token);
      else setErr(res?.error ?? "Registration failed");
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : "Registration failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/80 p-4">
      <form onSubmit={go} className="w-full max-w-md rounded border border-border bg-card p-5">
        <h2 className="font-mono text-lg font-bold">BUYER REGISTRATION</h2>
        <p className="mt-1 font-mono text-xs text-muted-foreground">
          One step. Unlocks exact street addresses and full title decks.
        </p>
        {(
          [
            ["name", "Full name", true],
            ["entity", "Entity / LLC name", true],
            ["email", "Email", true],
            ["phone", "Phone (optional)", false],
            ["proof_of_funds", "Proof of funds / ACH mandate link", false],
          ] as const
        ).map(([k, label, req]) => (
          <input
            key={k}
            required={req}
            type={k === "email" ? "email" : "text"}
            maxLength={300}
            placeholder={label}
            value={(form as any)[k]}
            onChange={(e) => setForm({ ...form, [k]: e.target.value })}
            className="mt-3 w-full rounded border border-border bg-background px-3 py-2 font-mono text-sm"
          />
        ))}
        {err && <p className="mt-3 font-mono text-xs text-destructive">{err}</p>}
        <div className="mt-4 flex gap-2">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 rounded border border-border px-3 py-2 font-mono text-sm"
          >
            CANCEL
          </button>
          <button
            disabled={busy}
            className="flex-1 rounded bg-primary px-3 py-2 font-mono text-sm font-bold text-primary-foreground disabled:opacity-50"
          >
            {busy ? "…" : "VERIFY & UNLOCK"}
          </button>
        </div>
      </form>
    </div>
  );
}
