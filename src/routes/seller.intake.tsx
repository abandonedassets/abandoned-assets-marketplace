import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { submitSellerIntake } from "@/lib/seller-intake.functions";

export const Route = createFileRoute("/seller/intake")({
  head: () => ({
    meta: [
      { title: "Submit Your Property — Institutional Cash Offer" },
      {
        name: "description",
        content:
          "Submit your property for an institutional cash offer. Fast underwriting, direct-to-buyer placement, no listing required.",
      },
      { property: "og:title", content: "Submit Your Property — Institutional Cash Offer" },
      {
        property: "og:description",
        content:
          "Submit your property for an institutional cash offer. Fast underwriting, direct-to-buyer placement.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: SellerIntake,
  errorComponent: ({ error }) => (
    <div className="p-6 font-mono text-sm text-destructive">ERR :: {error.message}</div>
  ),
  notFoundComponent: () => <div className="p-6">Not found</div>,
});

const num = (v: FormDataEntryValue | null) => {
  const n = Number(String(v ?? "").replace(/[^0-9.]/g, ""));
  return Number.isFinite(n) && n > 0 ? n : undefined;
};

function SellerIntake() {
  const submit = useServerFn(submitSellerIntake);
  const [done, setDone] = useState<string | null>(null);

  const m = useMutation({
    mutationFn: (payload: any) => submit({ data: payload }),
    onSuccess: (r: any) => {
      setDone(r.id);
      toast.success("Property submitted to the pipeline");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (done) {
    return (
      <main className="mx-auto max-w-xl p-8 font-mono">
        <h1 className="text-2xl font-bold">Submission received</h1>
        <p className="mt-3 text-sm text-muted-foreground">
          Reference: <span className="text-foreground">{done.slice(0, 8)}</span>
        </p>
        <p className="mt-3 text-sm">
          Your property is now in underwriting. Matching against our active buyer network
          begins automatically.
        </p>
        <button className="mt-6 underline text-sm" onClick={() => setDone(null)}>
          Submit another property
        </button>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-2xl p-6 md:p-10">
      <h1 className="text-3xl font-bold tracking-tight">Submit Your Property</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        Institutional cash buyers. No listing, no showings. Underwriting starts on submit.
      </p>

      <form
        className="mt-8 grid gap-4 md:grid-cols-2"
        onSubmit={(e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          m.mutate({
            address: String(f.get("address") ?? "").trim(),
            city: String(f.get("city") ?? "").trim(),
            state: String(f.get("state") ?? "").trim(),
            zip: String(f.get("zip") ?? "").trim(),
            asking_price: num(f.get("asking_price")) ?? 0,
            arv: num(f.get("arv")),
            beds: num(f.get("beds")),
            baths: num(f.get("baths")),
            sqft: num(f.get("sqft")),
            year_built: num(f.get("year_built")),
            asset_type: String(f.get("asset_type") ?? "SFR"),
            notes: String(f.get("notes") ?? "").trim() || undefined,
          });
        }}
      >
        <Field className="md:col-span-2" name="address" label="Property address" required />
        <Field name="city" label="City" />
        <Field name="state" label="State (2-letter)" maxLength={2} />
        <Field name="zip" label="ZIP code" required inputMode="numeric" />
        <div className="grid gap-1">
          <label className="text-xs uppercase text-muted-foreground" htmlFor="asset_type">
            Property type
          </label>
          <select
            id="asset_type"
            name="asset_type"
            className="h-10 rounded-md border border-input bg-background px-3 text-sm"
          >
            <option value="SFR">Single family</option>
            <option value="MF">Multi-family</option>
            <option value="Condo">Condo</option>
            <option value="Land">Land</option>
            <option value="Commercial">Commercial</option>
          </select>
        </div>
        <Field name="asking_price" label="Asking price (USD)" required inputMode="numeric" />
        <Field name="arv" label="Est. after-repair value (optional)" inputMode="numeric" />
        <Field name="beds" label="Beds" inputMode="numeric" />
        <Field name="baths" label="Baths" inputMode="numeric" />
        <Field name="sqft" label="Square feet" inputMode="numeric" />
        <Field name="year_built" label="Year built" inputMode="numeric" />
        <div className="grid gap-1 md:col-span-2">
          <label className="text-xs uppercase text-muted-foreground" htmlFor="notes">
            Condition / notes
          </label>
          <textarea
            id="notes"
            name="notes"
            rows={4}
            maxLength={1000}
            className="rounded-md border border-input bg-background p-3 text-sm"
          />
        </div>

        <button
          type="submit"
          disabled={m.isPending}
          className="md:col-span-2 h-11 rounded-md bg-primary px-6 text-sm font-semibold text-primary-foreground disabled:opacity-50"
        >
          {m.isPending ? "Submitting…" : "Submit property"}
        </button>
      </form>
    </main>
  );
}

function Field({
  name,
  label,
  className,
  ...rest
}: { name: string; label: string; className?: string } & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <div className={`grid gap-1 ${className ?? ""}`}>
      <label className="text-xs uppercase text-muted-foreground" htmlFor={name}>
        {label}
      </label>
      <input
        id={name}
        name={name}
        className="h-10 rounded-md border border-input bg-background px-3 text-sm"
        {...rest}
      />
    </div>
  );
}
