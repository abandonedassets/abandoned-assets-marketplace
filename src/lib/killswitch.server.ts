// Global outbound HALT. When system_config.SYSTEM_KILL_SWITCH is true, every
// outbound side effect (invoice mint, webhook dispatch, notification) must stop.

export class KillSwitchError extends Error {
  status = 503;
  constructor() {
    super("SYSTEM_KILL_SWITCH engaged — all outbound traffic halted");
  }
}

export async function isKillSwitchOn(): Promise<boolean> {
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data } = await supabaseAdmin
      .from("system_config")
      .select("value")
      .eq("key", "SYSTEM_KILL_SWITCH")
      .maybeSingle();
    const v = (data as { value?: unknown } | null)?.value;
    return v === true || v === "true";
  } catch {
    return false; // fail-forward: never stall the pipeline on a read error
  }
}

export async function assertOutboundAllowed(): Promise<void> {
  if (await isKillSwitchOn()) throw new KillSwitchError();
}
