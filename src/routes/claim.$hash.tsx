import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { getClaimAsset, submitClaim } from "@/lib/claim.functions";

export const Route = createFileRoute("/claim/$hash")({
  head: () => ({
    meta: [
      { title: "Claim Your Parcel Allocation — Institutional Capital Match" },
      {
        name: "description",
        content:
          "A pre-qualified 1031 exchange buyer has cleared this parcel. Verify ownership and authorize the allocation in under a minute.",
      },
      { property: "og:title", content: "Notice of Institutional Capital Matching" },
      {
        property: "og:description",
        content: "Pre-cleared cash allocation available for this parcel. Claim and authorize now.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "robots", content: "noindex" },
    ],
  }),
  validateSearch: (search: Record<string, unknown>) => ({
    id: typeof search["id"] === "string" ? (search["id"] as string) : undefined,
    apn: typeof search["apn"] === "string" ? (search["apn"] as string) : undefined,
  }),
  component: ClaimPage,
  errorComponent: ({ error }) => (
    <div className="p-6 font-mono text-sm text-destructive">ERR :: {error.message}</div>
  ),
  notFoundComponent: () => <div className="p-6 font-mono text-sm">Claim link not found</div>,
});

const usd = (n: number) => `$${Math.round(n).toLocaleString()}`;

function ClaimPage() {
  const { hash } = Route.useParams();
  const { id, apn } = Route.useSearch();
  const load = useServerFn(getClaimAsset);
  const send = useServerFn(submitClaim);

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [agree, setAgree] = useState(false);
  const [done, setDone] = useState<string | null>(null);

  const { data, isLoading, error } = useQuery({
    queryKey: ["claim", hash, id ?? apn],
    queryFn: () => load({ data: { hash, ...(id ? { id } : {}), ...(apn ? { apn } : {}) } }),
  });

  const m = useMutation({
    mutationFn: () =>
      send({
        data: {
          hash,
          assetId: data!.id,
          legalName: name.trim(),
          email: email.trim(),
          phone: phone.trim(),
          agree: true as const,
        },
      }),
    onSuccess: (r: { signedAt: string }) => {
      setDone(r.signedAt);
      toast.success("Allocation claimed — capital dispatched");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (isLoading) return <div className="p-8 font-mono text-sm">Verifying claim token…</div>;
  if (error)
    return <div className="p-8 font-mono text-sm text-destructive">{(error as Error).message}</div>;
  if (!data) return null;

  const settled = done ?? (data.already_signed ? data.signed_at : null);

  if (settled) {
    return (
      <main className="mx-auto max-w-xl p-8 font-mono">
        <h1 className="text-2xl font-bold">Allocation claimed</h1>
        <p className="mt-3 text-sm text-muted-foreground">
          Authorized {new Date(String(settled)).toLocaleString()}
        </p>
        <p className="mt-4 text-sm">
          Parcel {data.apn ?? data.address ?? data.zip} has been dispatched to matched 1031 capital.
          Closing coordination will reach you at the contact details on file.
        </p>
      </main>
    );
  }

  const disabled =
    !agree ||
    name.trim().length < 2 ||
    !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim()) ||
    phone.trim().length < 7 ||
    m.isPending;

  return (
    <main className="mx-auto max-w-2xl p-6 font-mono">
      <div className="text-xs uppercase tracking-widest text-muted-foreground">
        Notice of Institutional Capital Matching
      </div>
      <h1 className="mt-2 text-2xl font-bold">
        Parcel {data.apn ?? data.address ?? `${data.city ?? ""} ${data.zip}`}
      </h1>

      <section className="mt-4 rounded-md border border-primary bg-primary/5 p-4">
        <div className="text-sm">
          A pre-qualified 1031 exchange buyer has <strong>cleared this property</strong> at
        </div>
        <div className="mt-1 text-3xl font-bold">{usd(data.offer)}</div>
        <p className="mt-2 text-xs text-muted-foreground">
          Funds are pre-committed. Claim this allocation below to authorize marketing and assignment
          — no listing, no commission, no repairs.
        </p>
      </section>

      <section className="mt-6 grid grid-cols-2 gap-2 rounded-md border border-border p-4 text-sm text-muted-foreground">
        <div>
          Address:{" "}
          <span className="text-foreground">
            {data.address ?? "—"}
            {data.city ? `, ${data.city}` : ""} {data.state ?? ""} {data.zip}
          </span>
        </div>
        <div>
          Class: <span className="text-foreground">{data.asset_type ?? "—"}</span>
        </div>
        <div>
          Zoning: <span className="text-foreground">{data.zoning_category ?? "—"}</span>
        </div>
        <div>
          Underwritten ARV:{" "}
          <span className="text-foreground">{data.arv ? usd(data.arv) : "—"}</span>
        </div>
      </section>

      <section className="mt-6 max-h-56 overflow-y-auto rounded-md border border-border p-4 text-xs leading-relaxed text-muted-foreground">
        <p>
          By claiming, the authorized party grants Operator a non-exclusive authorization to market
          the above-referenced parcel and to assign, syndicate, or otherwise transfer Operator&apos;s
          equitable contract interest to third-party buyers, funds, and qualified intermediaries.
        </p>
        <p className="mt-3">
          Operator acts as a principal holding equitable interest and is not acting as a licensed
          real estate broker or agent. Operator may earn an assignment fee, disclosed at closing on
          the settlement statement. This authorization is non-exclusive and revocable in writing
          prior to a buyer&apos;s execution of an assignment.
        </p>
        <p className="mt-3">
          Submitting the form adopts the typed name as an electronic signature under E-SIGN/UETA. IP
          address, user agent, and timestamp are recorded as evidence of execution.
        </p>
      </section>

      <div className="mt-6 space-y-3">
        <label className="block text-sm">
          Authorized party (owner or broker)
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={120}
            placeholder="Jane Q. Owner"
            className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-base outline-none focus:ring-2 focus:ring-ring"
          />
        </label>
        <label className="block text-sm">
          Direct email
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            maxLength={255}
            placeholder="you@example.com"
            className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-base outline-none focus:ring-2 focus:ring-ring"
          />
        </label>
        <label className="block text-sm">
          Direct mobile phone
          <input
            type="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            maxLength={32}
            placeholder="(555) 555-0134"
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
          I am authorized to convey this parcel, agree to the authorization above, and consent to
          electronic signature.
        </label>
        <button
          disabled={disabled}
          onClick={() => m.mutate()}
          className="w-full rounded-md bg-primary px-4 py-3 text-sm font-bold text-primary-foreground disabled:opacity-40"
        >
          {m.isPending ? "CLEARING…" : `CLAIM ALLOCATION AT ${usd(data.offer)}`}
        </button>
      </div>
    </main>
  );
}
