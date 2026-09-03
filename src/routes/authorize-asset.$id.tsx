import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { executeSellerAuthorization, getAuthorizeAsset } from "@/lib/seller-portal.functions";

export const Route = createFileRoute("/authorize-asset/$id")({
  head: () => ({
    meta: [
      { title: "Authorize Asset — Marketing & Assignment" },
      {
        name: "description",
        content:
          "Securely authorize marketing and assignment of your property. Institutional clearing, no fees, no listings.",
      },
      { property: "og:title", content: "Authorize Asset — Marketing & Assignment" },
      {
        property: "og:description",
        content: "One-tap seller authorization for institutional capital clearing.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  validateSearch: (s: Record<string, unknown>) => ({ token: String(s["token"] ?? "") }),
  component: AuthorizeAsset,
  errorComponent: ({ error }) => (
    <div className="p-6 font-mono text-sm text-destructive">ERR :: {error.message}</div>
  ),
  notFoundComponent: () => <div className="p-6 font-mono text-sm">Not found</div>,
});

const usd = (n: number | null | undefined) =>
  typeof n === "number" ? `$${Math.round(n).toLocaleString()}` : "—";

function AuthorizeAsset() {
  const { id } = Route.useParams();
  const { token } = Route.useSearch();
  const load = useServerFn(getAuthorizeAsset);
  const sign = useServerFn(executeSellerAuthorization);
  const [name, setName] = useState("");
  const [agree, setAgree] = useState(false);
  const [done, setDone] = useState<{ signedAt: string; dispatched: boolean } | null>(null);

  const { data, isLoading, error } = useQuery({
    queryKey: ["authorize-asset", id, token],
    queryFn: () => load({ data: { assetId: id, token } }),
    enabled: token.length > 8,
  });

  const m = useMutation({
    mutationFn: () =>
      sign({ data: { assetId: id, token, legalName: name.trim(), agree: true as const } }),
    onSuccess: (r) => {
      setDone({ signedAt: r.signedAt, dispatched: r.dispatched });
      toast.success("Authorization executed");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (token.length <= 8)
    return <main className="p-8 font-mono text-sm text-destructive">MISSING_TOKEN</main>;
  if (isLoading) return <main className="p-8 font-mono text-sm">Loading authorization…</main>;
  if (error)
    return <main className="p-8 font-mono text-sm text-destructive">{(error as Error).message}</main>;

  const a = data!;
  const signedAt = done?.signedAt ?? (a.already_signed ? a.signed_at : null);

  if (signedAt) {
    return (
      <main className="mx-auto max-w-xl p-6 font-mono">
        <h1 className="text-2xl font-bold">Authorization on file</h1>
        <p className="mt-3 text-sm text-muted-foreground">
          Executed {new Date(signedAt).toLocaleString()}
        </p>
        <p className="mt-4 text-sm">
          Your property has been tokenized and released to the institutional buy-box network.
          {done?.dispatched ? " A matched buyer allocation has already been dispatched." : ""}
        </p>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-2xl p-5 font-mono">
      <h1 className="text-xl font-bold sm:text-2xl">Marketing & Assignment Authorization</h1>
      <p className="mt-1 text-xs text-muted-foreground">
        Non-exclusive. No listing fees. No commissions.
      </p>

      <section className="mt-5 rounded-md border border-border p-4 text-sm">
        <div className="text-base">
          {a.address ?? "—"}
          {a.city ? `, ${a.city}` : ""} {a.state ?? ""} {a.zip ?? ""}
        </div>
        <dl className="mt-3 grid grid-cols-2 gap-2 text-xs text-muted-foreground">
          <div>
            APN: <span className="text-foreground">{a.apn ?? "—"}</span>
          </div>
          <div>
            Asset Type: <span className="text-foreground">{a.asset_type ?? "—"}</span>
          </div>
          <div>
            Target Clearing Price:{" "}
            <span className="text-foreground">{usd(a.base_contract_price)}</span>
          </div>
          <div>
            Market Status: <span className="text-foreground">{a.status ?? "Dormant"}</span>
          </div>
        </dl>
      </section>

      <section className="mt-5 max-h-56 overflow-y-auto rounded-md border border-border p-4 text-xs leading-relaxed text-muted-foreground">
        <p>
          By executing below, the undersigned owner ("Seller") grants a non-exclusive authorization
          to market the above-referenced property and to assign any resulting purchase contract to a
          third-party buyer. Seller confirms authority to convey the property, warrants that the
          information above is materially accurate, and understands that any purchase contract is a
          separate written agreement requiring Seller's signature.
        </p>
        <p className="mt-2">
          No fee, commission, or cost is charged to Seller. This authorization may be revoked in
          writing at any time prior to execution of a purchase contract. Seller consents to
          electronic signature and to receipt of transaction communications by email and SMS. Seller
          acknowledges that the execution timestamp, IP address, and device signature will be
          recorded for compliance auditing.
        </p>
      </section>

      <label className="mt-5 block text-xs text-muted-foreground" htmlFor="legal-name">
        Type your full legal name to sign
      </label>
      <input
        id="legal-name"
        value={name}
        onChange={(e) => setName(e.target.value)}
        autoComplete="name"
        placeholder="Full legal name"
        className="mt-1 w-full rounded-md border border-border bg-background px-3 py-3 text-base outline-none focus:border-primary"
      />

      <label className="mt-4 flex items-start gap-2 text-xs">
        <input
          type="checkbox"
          checked={agree}
          onChange={(e) => setAgree(e.target.checked)}
          className="mt-0.5"
        />
        <span>
          I am an owner of record (or authorized signer) and I agree to the Marketing & Assignment
          Authorization above.
        </span>
      </label>

      <button
        type="button"
        disabled={!agree || name.trim().length < 2 || m.isPending}
        onClick={() => m.mutate()}
        className="mt-5 w-full rounded-md bg-primary px-4 py-4 text-base font-bold text-primary-foreground disabled:opacity-40"
      >
        {m.isPending ? "EXECUTING…" : "EXECUTE AUTHORIZATION"}
      </button>
    </main>
  );
}
