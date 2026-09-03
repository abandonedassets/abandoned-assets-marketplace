import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type Endpoint = {
  id: string;
  name: string;
  url: string;
  is_active: boolean;
  priority_score: number;
  last_dispatched_at: string | null;
  created_at: string;
};

export const listEndpoints = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("routing_endpoints")
      .select("id,name,url,is_active,priority_score,last_dispatched_at,created_at")
      .order("priority_score", { ascending: false });
    if (error) throw new Error(error.message);
    return (data ?? []) as Endpoint[];
  });

export const registerEndpoint = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { name: string; url: string }) => {
    const name = String(d?.name ?? "").trim();
    const url = String(d?.url ?? "").trim();
    if (name.length < 2 || name.length > 100) throw new Error("invalid_name");
    if (!/^https:\/\/[^\s]+$/i.test(url) || url.length > 500) throw new Error("url_must_be_https");
    return { name, url };
  })
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("routing_endpoints")
      .insert({ name: data.name, url: data.url, is_active: true } as never);
    if (error) throw new Error(error.message);
    return { ok: true as const };
  });

export const toggleEndpoint = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { id: string; is_active: boolean }) => {
    if (!d?.id) throw new Error("invalid_id");
    return { id: d.id, is_active: !!d.is_active };
  })
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("routing_endpoints")
      .update({ is_active: data.is_active } as never)
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true as const };
  });

/** Fires a mock property payload at a registered endpoint and logs latency. */
export const testPingEndpoint = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { id: string }) => {
    if (!d?.id) throw new Error("invalid_id");
    return d;
  })
  .handler(async ({ data, context }) => {
    const { data: ep, error } = await context.supabase
      .from("routing_endpoints")
      .select("id,url,name")
      .eq("id", data.id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!ep) throw new Error("not_found");

    const payload = {
      event: "test.ping",
      asset: {
        external_id: "MOCK-0001",
        address: "1200 Courtyard Cir",
        city: "Aurora",
        state: "IL",
        zip: "60504",
        asset_type: "SFR",
        beds: 3,
        baths: 2,
        sqft: 1620,
        base_contract_price: 145000,
        optimized_acquisition_premium: 12500,
        title_status: "Insured",
      },
      issued_at: new Date().toISOString(),
    };

    const started = Date.now();
    try {
      const res = await fetch((ep as { url: string }).url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(10_000),
      });
      return {
        ok: res.ok,
        status: res.status,
        latency_ms: Date.now() - started,
      };
    } catch (e) {
      return {
        ok: false,
        status: 0,
        latency_ms: Date.now() - started,
        error: (e as Error).message,
      };
    }
  });
