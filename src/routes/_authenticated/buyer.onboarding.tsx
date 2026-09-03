import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { submitBuyBox, listMyBuyBoxes } from "@/lib/buyer.functions";

export const Route = createFileRoute("/_authenticated/buyer/onboarding")({
  head: () => ({
    meta: [
      { title: "Buyer Onboarding — Define Your Buy Box" },
      { name: "robots", content: "noindex,nofollow" },
    ],
  }),
  component: BuyerOnboarding,
  errorComponent: ({ error }) => (
    <div className="p-6 font-mono text-sm text-destructive">ERR :: {error.message}</div>
  ),
  notFoundComponent: () => <div className="p-6">Not found</div>,
});

function BuyerOnboarding() {
  const submit = useServerFn(submitBuyBox);
  const list = useServerFn(listMyBuyBoxes);
  const qc = useQueryClient();

  const { data: boxes } = useQuery({
    queryKey: ["my-buy-boxes"],
    queryFn: () => list({ data: {} as never }),
  });

  const m = useMutation({
    mutationFn: (payload: any) => submit({ data: payload }),
    onSuccess: () => {
      toast.success("Buy box live — matching begins immediately");
      qc.invalidateQueries({ queryKey: ["my-buy-boxes"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="mx-auto max-w-3xl p-6 md:p-10">
      <h1 className="text-2xl font-bold tracking-tight">Buyer Onboarding</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        Define acquisition criteria. Assets are scored against your box the moment they enter
        the pipeline.
      </p>

      <form
        className="mt-8 grid gap-4 md:grid-cols-2"
        onSubmit={(e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          const zips = String(f.get("zips") ?? "")
            .split(/[\s,]+/)
            .map((z) => z.trim())
            .filter(Boolean);
          const types = String(f.get("types") ?? "")
            .split(/[\s,]+/)
            .map((t) => t.trim())
            .filter(Boolean);
          m.mutate({
            label: String(f.get("label") ?? "").trim(),
            target_zip_codes: zips,
            target_asset_types: types.length ? types : ["SFR"],
            max_contract_price: Number(String(f.get("max_price") ?? "").replace(/[^0-9.]/g, "")),
            min_placement_margin: Number(String(f.get("min_margin") ?? "").replace(/[^0-9.]/g, "")),
            buyer_priority: String(f.get("priority") ?? "standard"),
          });
        }}
      >
        <F className="md:col-span-2" name="label" label="Fund / entity name" required />
        <F
          className="md:col-span-2"
          name="zips"
          label="Target ZIP codes (comma separated)"
          placeholder="45402, 45403, 60506"
          required
        />
        <F name="types" label="Asset types" placeholder="SFR, MF" />
        <div className="grid gap-1">
          <label className="text-xs uppercase text-muted-foreground" htmlFor="priority">
            Capital capability
          </label>
          <select
            id="priority"
            name="priority"
            className="h-10 rounded-md border border-input bg-background px-3 text-sm"
          >
            <option value="standard">Standard</option>
            <option value="priority">Priority</option>
            <option value="institutional">Institutional</option>
          </select>
        </div>
        <F name="max_price" label="Max contract price (USD)" required inputMode="numeric" />
        <F name="min_margin" label="Min net yield / margin (%)" required inputMode="numeric" />

        <button
          type="submit"
          disabled={m.isPending}
          className="md:col-span-2 h-11 rounded-md bg-primary px-6 text-sm font-semibold text-primary-foreground disabled:opacity-50"
        >
          {m.isPending ? "Saving…" : "Activate buy box"}
        </button>
      </form>

      <section className="mt-10">
        <h2 className="text-xs uppercase tracking-widest text-muted-foreground">
          Your active boxes
        </h2>
        <div className="mt-3 space-y-2 font-mono text-xs">
          {(boxes ?? []).length === 0 && (
            <p className="text-muted-foreground">No buy boxes yet.</p>
          )}
          {((boxes ?? []) as any[]).map((b) => (
            <div key={b.id} className="border border-border p-3">
              <div className="flex flex-wrap gap-3">
                <strong>{b.label ?? "Unnamed"}</strong>
                <span>{b.active ? "ACTIVE" : "PAUSED"}</span>
                <span>max ${Math.round(Number(b.max_contract_price)).toLocaleString()}</span>
                <span>min margin {Number(b.min_placement_margin)}%</span>
              </div>
              <div className="mt-1 text-muted-foreground">
                {(b.target_asset_types ?? []).join(", ")} · {(b.target_zip_codes ?? []).join(" ")}
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

function F({
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
