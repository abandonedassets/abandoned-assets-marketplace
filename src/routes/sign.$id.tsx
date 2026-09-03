// One-click buyer closing portal — pre-underwritten proof sheet + binding execution.
import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { getContractSheet, executeContract, type ContractSheet } from "@/lib/closing.functions";
import {
  logOfferEvent,
  rejectOffer,
  REJECTION_CODES,
  REJECTION_LABELS,
  type RejectionCode,
} from "@/lib/offer-telemetry.functions";
import { WireSettlementPanel } from "@/components/WireSettlementPanel";
import { startReservation, type Reservation } from "@/lib/reservation.functions";


export const Route = createFileRoute("/sign/$id")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Execute Binding Contract | Buyer Closing Portal" },
      {
        name: "description",
        content:
          "Pre-underwritten proof sheet with M2M value, cap rate and lien clearance — execute the assignable PSA and wire EMD in one click.",
      },
      { property: "og:title", content: "Execute Binding Contract | Buyer Closing Portal" },
      {
        property: "og:description",
        content: "One-click binding execution of a pre-underwritten assignable purchase contract.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "robots", content: "noindex,nofollow" },
    ],
  }),
  component: SignPortal,
});

const money = (n: any) => `$${Math.round(Number(n) || 0).toLocaleString("en-US")}`;

function Countdown({ iso, onExpire }: { iso: string | null | undefined; onExpire?: () => void }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  useEffect(() => {
    if (!iso) return;
    const ms = new Date(iso).getTime() - Date.now();
    if (ms <= 0) {
      onExpire?.();
      return;
    }
    const t = setTimeout(() => onExpire?.(), ms);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [iso]);
  if (!iso) return <span className="text-muted-foreground">no active window</span>;
  const ms = new Date(iso).getTime() - now;
  if (ms <= 0) return <span className="text-destructive">EXPIRED — CASCADING</span>;
  const m = Math.floor(ms / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  return (
    <span className="text-emerald-500">
      {String(m).padStart(2, "0")}:{String(s).padStart(2, "0")} REMAINING
    </span>
  );
}

function SignPortal() {
  const { id } = Route.useParams();
  const [sheet, setSheet] = useState<ContractSheet | null>(null);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<any>(null);
  const [err, setErr] = useState<string | null>(null);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [rejectCode, setRejectCode] = useState<RejectionCode | null>(null);
  const [counter, setCounter] = useState("");
  const [rejected, setRejected] = useState<any>(null);
  const [resv, setResv] = useState<Reservation | null>(null);
  const [resvExpired, setResvExpired] = useState(false);

  useEffect(() => {
    getContractSheet({ data: { id } })
      .then(setSheet)
      .catch((e) => setErr(String(e)));
    void logOfferEvent({ data: { contractId: id, status: "OPENED" } }).catch(() => {});
    // Scarcity engine — a click on the deal link opens a 15-minute exclusive lock.
    void startReservation({ data: { id } })
      .then((r) => {
        setResv(r);
        if (r?.expires_at && new Date(r.expires_at).getTime() <= Date.now()) setResvExpired(true);
      })
      .catch(() => {});
  }, [id]);

  // Engagement heartbeat — first meaningful interaction registers a CLICKED signal.
  useEffect(() => {
    let fired = false;
    const fire = () => {
      if (fired) return;
      fired = true;
      void logOfferEvent({ data: { contractId: id, status: "CLICKED" } }).catch(() => {});
    };
    window.addEventListener("pointerdown", fire, { once: true });
    window.addEventListener("keydown", fire, { once: true });
    return () => {
      window.removeEventListener("pointerdown", fire);
      window.removeEventListener("keydown", fire);
    };
  }, [id]);

  async function submit() {
    setBusy(true);
    setErr(null);
    try {
      const r: any = await executeContract({ data: { id, signerName: name, buyerEmail: email } });
      if (!r?.ok) setErr(r?.error ?? "execution_failed");
      else {
        setDone(r);
        void logOfferEvent({ data: { contractId: id, status: "EXECUTED" } }).catch(() => {});
      }
    } catch (e) {
      setErr(String(e));
    } finally {
      setBusy(false);
    }
  }

  async function submitReject() {
    if (!rejectCode) return;
    setBusy(true);
    setErr(null);
    try {
      const r: any = await rejectOffer({
        data: {
          id,
          code: rejectCode,
          targetPrice: counter.trim() ? Number(counter.replace(/[^0-9.]/g, "")) : null,
        },
      });
      if (!r?.ok) setErr(r?.error ?? "rejection_failed");
      else {
        setRejected(r);
        setRejectOpen(false);
      }
    } catch (e) {
      setErr(String(e));
    } finally {
      setBusy(false);
    }
  }


  if (err && !sheet) return <Shell><p className="text-destructive">{err}</p></Shell>;
  if (!sheet) return <Shell><p className="text-muted-foreground">Loading proof sheet…</p></Shell>;
  if (!sheet.ok) return <Shell><p className="text-destructive">Contract not found.</p></Shell>;

  const p = (sheet.payload ?? {}) as any;
  const prop = p.property ?? {};
  const econ = p.economics ?? {};
  const uw = p.underwriting ?? {};
  const est = p.estoppel_bundle ?? {};
  const executed = sheet.tif_state === "Executed" || done;

  return (
    <Shell>
      <header className="flex flex-wrap items-center justify-between gap-3 border-b pb-4">
        <div>
          <h1 className="font-mono text-[11px] uppercase tracking-widest text-muted-foreground">
            pre-underwritten verification sheet
          </h1>
          <p className="text-xl font-semibold">
            {prop.address ?? "Asset"} {prop.city ? `· ${prop.city}, ${prop.state} ${prop.zip}` : ""}
          </p>
        </div>
        <div className="rounded-full border px-3 py-1 font-mono text-[11px]">
          EXCLUSIVE RESERVATION ·{" "}
          <Countdown
            iso={resv?.expires_at ?? sheet.tif_expires_at}
            onExpire={() => setResvExpired(true)}
          />
        </div>
      </header>

      {!executed && !rejected && (
        <div
          className={`rounded-lg border px-4 py-2 font-mono text-[11px] uppercase tracking-widest ${
            resvExpired
              ? "border-destructive/50 bg-destructive/10 text-destructive"
              : "border-amber-500/40 bg-amber-500/10 text-amber-500"
          }`}
        >
          {resvExpired ? (
            <>reservation expired — asset auto-routed to the next fund in the waterfall</>
          ) : (
            <>
              {Math.max(resv?.concurrent_viewers ?? 0, 0)} other institutional buyer
              {(resv?.concurrent_viewers ?? 0) === 1 ? " is" : "s are"} reviewing this property ·
              asset auto-routes in{" "}
              <Countdown iso={resv?.expires_at} onExpire={() => setResvExpired(true)} />
            </>
          )}
        </div>
      )}

      <section className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Cell label="M2M Value" value={money(uw.m2m_value)} />
        <Cell label="Contract Price" value={money(econ.base_contract_price)} />
        <Cell label="Target Cap / Spread" value={`${Number(uw.target_cap_rate ?? 0).toFixed(2)}%`} />
        <Cell label="Assignment Fee" value={money(econ.assignment_fee)} accent />
        <Cell label="Recorded Liens" value={money(econ.recorded_liens)} />
        <Cell label="Net To Seller" value={money(econ.net_to_seller)} />
        <Cell label="Title Status" value={String(uw.title_status ?? "Pending")} />
        <Cell
          label="Lien Clearance"
          value={est.lien_status_verified ? "CERTIFIED CLEAR" : `T+${est.impact_days ?? 14} PENDING`}
        />
      </section>

      <section className="rounded-lg border bg-card p-4 font-mono text-[11px] leading-relaxed">
        <div className="mb-2 uppercase tracking-widest text-muted-foreground">assignable PSA terms</div>
        <div>Parcel / APN: {prop.apn ?? "—"} · Asset: {prop.asset_type ?? "—"}</div>
        <div>Seller escrow entity: {p.seller_escrow_entity ?? "—"}</div>
        <div>Wire rail: {p.wiring?.rail ?? "Bluevine Primary"} · EMD due: {money(econ.emd_hold_usd ?? 1000)}</div>
        <div>Total acquisition cost: {money(econ.total_acquisition_cost)}</div>
        <div className="mt-2 text-muted-foreground">
          Assignable · EMD non-refundable · 60-minute time-in-force exclusivity · anti-circumvention
          penalty {money(p.terms?.anti_circumvention_penalty_usd ?? 25000)}.
        </div>
      </section>

      {rejected ? (
        <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-4">
          <p className="font-semibold text-destructive">OFFER DECLINED — SIGNAL LOGGED</p>
          <p className="mt-1 font-mono text-[11px] text-muted-foreground">
            Reason: {REJECTION_LABELS[rejectCode as RejectionCode] ?? "—"} ·{" "}
            {rejected.recascaded_to ? "Re-offered to next buyer in queue." : "Returned to shadow queue."}
          </p>
        </div>
      ) : executed ? (
        <>
          <div className="rounded-lg border border-emerald-500/40 bg-emerald-500/10 p-4">
            <p className="font-semibold text-emerald-500">CONTRACT EXECUTED — ASSIGNMENT FEE DUE</p>
            <p className="mt-1 font-mono text-[11px] text-muted-foreground">
              EMD hold: {done?.emd?.status ?? "authorized"} · Fee booked:{" "}
              {money(done?.assignment_fee ?? econ.assignment_fee)}
            </p>
          </div>
          <WireSettlementPanel dealId={id} />
        </>
      ) : (
        <section className="space-y-3 rounded-lg border bg-card p-4">
          <div className="grid gap-3 md:grid-cols-2">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Authorized signer name"
              className="rounded border bg-background px-3 py-2 text-sm"
            />
            <input
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              onBlur={() => {
                if (email.includes("@"))
                  void startReservation({ data: { id, buyerEmail: email.trim() } })
                    .then(setResv)
                    .catch(() => {});
              }}
              placeholder="Buyer email"
              className="rounded border bg-background px-3 py-2 text-sm"
            />
          </div>
          {err && <p className="font-mono text-[11px] text-destructive">{err}</p>}
          <button
            disabled={busy || resvExpired || !name.trim() || !email.includes("@")}
            onClick={() => void submit()}
            className="w-full rounded-lg bg-primary px-4 py-3 font-mono text-sm uppercase tracking-widest text-primary-foreground disabled:opacity-50"
          >
            {resvExpired
              ? "Reservation expired — deal released"
              : busy
                ? "executing…"
                : "Lock deal & sign assignment"}
          </button>
          <button
            onClick={() => setRejectOpen(true)}
            className="w-full rounded-lg border px-4 py-2 font-mono text-[11px] uppercase tracking-widest text-muted-foreground hover:bg-muted"
          >
            Opt-out / reject offer
          </button>
        </section>

      )}

      {rejectOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-md space-y-3 rounded-lg border bg-card p-4">
            <h2 className="font-mono text-[11px] uppercase tracking-widest text-muted-foreground">
              structured rejection — reason code
            </h2>
            <div className="space-y-2">
              {REJECTION_CODES.map((c) => (
                <label key={c} className="flex items-center gap-2 text-sm">
                  <input
                    type="radio"
                    name="reason"
                    checked={rejectCode === c}
                    onChange={() => setRejectCode(c)}
                  />
                  {REJECTION_LABELS[c]}
                </label>
              ))}
            </div>
            <input
              value={counter}
              onChange={(e) => setCounter(e.target.value)}
              placeholder="Target counter-offer price (optional)"
              inputMode="decimal"
              className="w-full rounded border bg-background px-3 py-2 text-sm"
            />
            {err && <p className="font-mono text-[11px] text-destructive">{err}</p>}
            <div className="flex gap-2">
              <button
                onClick={() => setRejectOpen(false)}
                className="flex-1 rounded border px-3 py-2 font-mono text-[11px] uppercase"
              >
                Cancel
              </button>
              <button
                disabled={busy || !rejectCode}
                onClick={() => void submitReject()}
                className="flex-1 rounded bg-destructive px-3 py-2 font-mono text-[11px] uppercase text-destructive-foreground disabled:opacity-50"
              >
                {busy ? "sending…" : "Submit rejection"}
              </button>
            </div>
          </div>
        </div>
      )}

    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="min-h-screen bg-background p-4 md:p-8">
      <div className="mx-auto max-w-3xl space-y-4">{children}</div>
    </main>
  );
}

function Cell({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="rounded-lg border bg-card p-3">
      <div className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">{label}</div>
      <div className={`mt-1 text-base font-semibold ${accent ? "text-emerald-500" : ""}`}>{value}</div>
    </div>
  );
}
