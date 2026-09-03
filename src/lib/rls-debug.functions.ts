import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { requireAdmin } from "@/lib/require-admin";

/** Admin-side read-back of the most recent synthetic rows (service_role). */
export const fetchRlsDebugRows = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await requireAdmin(context);
    const { supabaseAdmin } = await import(
      "@/integrations/supabase/client.server"
    );
    const [waitlist, events] = await Promise.all([
      supabaseAdmin
        .from("buyer_waitlist")
        .select("id, fund_name, contact_email, created_at")
        .order("created_at", { ascending: false })
        .limit(6),
      supabaseAdmin
        .from("conversion_events")
        .select("id, event, channel, created_at")
        .order("created_at", { ascending: false })
        .limit(6),
    ]);
    return {
      buyer_waitlist: waitlist.data ?? [],
      conversion_events: events.data ?? [],
      errors: [waitlist.error?.message, events.error?.message].filter(Boolean),
    };
  },
);
