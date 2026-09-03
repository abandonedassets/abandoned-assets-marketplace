import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { getSellerAgreementAsset, signMarketingAuth } from "@/lib/seller-auth.functions";

export const Route = createFileRoute("/seller/agreement/$assetId")({
  head: () => ({
    meta: [
      { title: "Marketing & Assignment Authorization — Seller E-Sign" },
      {
        name: "description",
        content:
          "Review and electronically sign the non-exclusive marketing and assignment authorization for your property.",
      },
      { property: "og:title", content: "Marketing & Assignment Authorization" },
      {
        property: "og:description",
        content: "Electronically authorize marketing and assignment of your property contract.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  validateSearch: (search: Record<string, unknown>) => ({
    offer: search["offer"] ? Number(search["offer"]) : undefined,
    token: search["token"] ? String(search["token"]) : "",
  }),
  component: SellerAgreement,
  errorComponent: ({ error }) => (
    <div className="p-6 font-mono text-sm text-destructive">ERR :: {error.message}</div>
  ),
  notFoundComponent: () => <div className="p-6">Not found</div>,
});

const usd = (n: unknown) =>
  typeof n === "number" ? `$${n.toLocaleString(undefined, { maximumFractionDigits: 0 })}` : "—";

function SellerAgreement() {
  const { assetId } = Route.useParams();
  const { offer, token } = Route.useSearch();
  const load = useServerFn(getSellerAgreementAsset);
  const sign = useServerFn(signMarketingAuth);
  const [name, setName] = useState("");
  const [agree, setAgree] = useState(false);
  const [signed, setSigned] = useState<string | null>(null);

  const { data, isLoading, error } = useQuery({
    queryKey: ["seller-agreement", assetId],
    queryFn: () => load({ data: { assetId, token } }),
    enabled: Boolean(token),
  });

  const m = useMutation({
    mutationFn: () => sign({
        data: {
          assetId,
          token,
          legalName: name.trim(),
          agree: true as const,
          ...(offer && offer > 0 ? { offer } : {}),
        },
      }),
    onSuccess: (r: { signedAt: string }) => {
      setSigned(r.signedAt);
      toast.success("Authorization executed");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (!token)
    return (
      <div className="p-8 font-mono text-sm text-destructive">
        INVALID LINK :: this authorization link is missing its secure token.
      </div>
    );
  if (isLoading) return <div className="p-8 font-mono text-sm">Loading agreement…</div>;
  if (error) return <div className="p-8 font-mono text-sm text-destructive">{(error as Error).message}</div>;

  const a = (data ?? {}) as Record<string, string | number | boolean | null>;
  const already = signed || a["marketing_auth_signed_at"];

  if (already) {
    return (
      <main className="mx-auto max-w-xl p-8 font-mono">
        <h1 className="text-2xl font-bold">Authorization on file</h1>
        <p className="mt-3 text-sm text-muted-foreground">
          Signed {new Date(String(already)).toLocaleString()}
        </p>
        <p className="mt-4 text-sm">
          Your property is now eligible for marketplace syndication and 1031 clearinghouse matching.
        </p>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-2xl p-6 font-mono">
      <h1 className="text-2xl font-bold">Non-Exclusive Marketing & Assignment Authorization</h1>

      {offer && offer > 0 ? (
        <section className="mt-4 rounded-md border border-primary bg-primary/5 p-4 text-sm">
          <div className="font-bold">Guaranteed cash offer: {usd(offer)}</div>
          <p className="mt-1 text-xs text-muted-foreground">
            Our institutional 1031 clearinghouse can guarantee an immediate closing at this price.
            Signing below clears this property for capital dispatch at {usd(offer)}.
          </p>
        </section>
      ) : null}

      <section className="mt-6 rounded-md border border-border p-4 text-sm">
        <div className="text-muted-foreground">Property</div>
        <div className="text-base">
          {String(a["address"] ?? "—")}
          {a["city"] ? `, ${String(a["city"])}` : ""} {String(a["state"] ?? "")} {String(a["zip"] ?? "")}
        </div>
        <div className="mt-3 grid grid-cols-2 gap-2 text-muted-foreground">
          <div>
            Asking Price: <span className="text-foreground">{usd(a["base_contract_price"])}</span>
          </div>
          <div>
            Asset Type: <span className="text-foreground">{String(a["asset_type"] ?? "—")}</span>
          </div>
        </div>
      </section>

      <section className="mt-6 max-h-72 overflow-y-auto rounded-md border border-border p-4 text-xs leading-relaxed text-muted-foreground">
        <p>
          Seller grants Operator a non-exclusive authorization to market the above-referenced
          property and to assign, syndicate, or otherwise transfer Operator&apos;s equitable
          contract interest to third-party buyers, funds, and qualified intermediaries.
        </p>
        <p className="mt-3">
          Seller acknowledges Operator is acting as a principal holding equitable interest and is
          not acting as a licensed real estate broker or agent for Seller. Operator may earn an
          assignment fee, disclosed at closing on the settlement statement.
        </p>
        <p className="mt-3">
          This authorization is non-exclusive, may be revoked in writing at any time prior to a
          buyer&apos;s execution of an assignment, and does not obligate Seller to sell. Seller
          represents authority to convey the property and that the information provided is accurate.
        </p>
        <p className="mt-3">
          By typing a full legal name below and submitting, Seller adopts the typed name as an
          electronic signature under E-SIGN/UETA. IP address, user agent, and timestamp are
          recorded as evidence of execution.
        </p>
      </section>

      <div className="mt-6 space-y-3">
        <label className="block text-sm">
          Full legal name
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={120}
            placeholder="Jane Q. Seller"
            className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-base outline-none focus:ring-2 focus:ring-ring"
          />
        </label>
        <label className="flex items-start gap-2 text-xs text-muted-foreground">
          <input
            type="checkbox"
            checked={agree}
            onChange={(e) => setAgree(e.target.checked)}
            className="mt-0.5"
          />
          I have read and agree to the authorization above and consent to electronic signature.
        </label>
        <button
          disabled={!agree || name.trim().length < 2 || m.isPending}
          onClick={() => m.mutate()}
          className="w-full rounded-md bg-primary px-4 py-3 text-sm font-bold text-primary-foreground disabled:opacity-40"
        >
          {m.isPending ? "EXECUTING…" : "SIGN & AUTHORIZE"}
        </button>
      </div>
    </main>
  );
}
