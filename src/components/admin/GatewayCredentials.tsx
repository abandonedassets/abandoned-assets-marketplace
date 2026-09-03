import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Eye, EyeOff, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { getSecretStatus, setAdminSecret } from "@/lib/secrets-admin.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";

/** Admin-only gateway credential entry. Values go straight to server-side
 *  storage; nothing is logged, cached, or rendered back. */
export function GatewayCredentials() {
  const qc = useQueryClient();
  const statusFn = useServerFn(getSecretStatus);
  const saveFn = useServerFn(setAdminSecret);

  const status = useQuery({
    queryKey: ["admin-secret-status"],
    queryFn: () => statusFn(),
  });

  const [value, setValue] = useState("");
  const [reveal, setReveal] = useState(false);

  const save = useMutation({
    mutationFn: (v: string) => saveFn({ data: { name: "STRIPE_SECRET_KEY", value: v } }),
    onSuccess: () => {
      setValue("");
      setReveal(false);
      toast.success("API key saved to secure server storage");
      qc.invalidateQueries({ queryKey: ["admin-secret-status"] });
    },
    onError: () => toast.error("Could not save the key. Check the format and try again."),
  });

  const stripe = (status.data ?? []).find((s) => s.name === "STRIPE_SECRET_KEY");
  const configured = Boolean(stripe?.configured);

  return (
    <section className="rounded-lg border border-border p-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div>
          <h2 className="font-mono text-sm font-semibold">Gateway Credentials</h2>
          <p className="text-xs text-muted-foreground">
            Stored server-side only. The key is never displayed after saving.
          </p>
        </div>
        <Badge variant={configured ? "default" : "secondary"}>
          {status.isLoading ? "Checking…" : configured ? "Configured" : "Not Configured"}
        </Badge>
      </div>

      <label htmlFor="stripe-secret-key" className="mb-1 block font-mono text-xs">
        STRIPE_SECRET_KEY
      </label>
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Input
            id="stripe-secret-key"
            type={reveal ? "text" : "password"}
            autoComplete="off"
            spellCheck={false}
            placeholder="sk_live_… or sk_test_…"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            className="pr-10 font-mono"
          />
          <button
            type="button"
            aria-label={reveal ? "Hide key" : "Reveal key"}
            onClick={() => setReveal((r) => !r)}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
          >
            {reveal ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </button>
        </div>
        <Button
          onClick={() => save.mutate(value.trim())}
          disabled={save.isPending || value.trim().length < 8}
        >
          {save.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          Save API Key
        </Button>
      </div>
      {stripe?.updated_at && (
        <p className="mt-2 font-mono text-[11px] text-muted-foreground">
          Last updated {new Date(stripe.updated_at).toLocaleString()} · source {stripe.source}
        </p>
      )}
    </section>
  );
}
