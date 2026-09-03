import { supabaseAdmin } from "@/integrations/supabase/client.server";

/**
 * Institutional Onboarding Protocol:
 * Automatic promotion from UAT_VERIFIED to PRODUCTION_ENABLED after 24h
 * of sustained activity (at least 10 successful M2M strikes).
 */
export async function processAutomaticPromotions() {
  const { data: candidates } = await supabaseAdmin
    .from("institutional_api_keys")
    .select("id, label, onboarding_state, uat_verified_at, first_intent_at")
    .eq("onboarding_state", "UAT_VERIFIED")
    .not("uat_verified_at", "is", null);

  if (!candidates) return;

  const now = Date.now();
  const ONE_DAY_MS = 24 * 60 * 60 * 1000;

  for (const k of candidates) {
    const uatStart = new Date(k.uat_verified_at!).getTime();
    if (now - uatStart < ONE_DAY_MS) continue;

    // Verify activity: >= 10 successful hits in the log
    const { count } = await supabaseAdmin
      .from("institutional_api_request_log")
      .select("id", { count: "exact", head: true })
      .eq("api_key_id", k.id)
      .eq("http_status", 200)
      .gte("requested_at", k.uat_verified_at!);

    if ((count ?? 0) >= 10) {
      await supabaseAdmin
        .from("institutional_api_keys")
        .update({
          onboarding_state: "PRODUCTION_ENABLED",
          production_enabled_at: new Date().toISOString()
        } as never)
        .eq("id", k.id);
      
      console.log(`[promotion] Key ${k.label} (${k.id}) promoted to PRODUCTION_ENABLED`);
    }
  }
}
