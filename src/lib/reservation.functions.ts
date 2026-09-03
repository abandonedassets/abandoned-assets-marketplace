// Scarcity engine — 15-minute exclusive deal reservation lock.
import { createServerFn } from "@tanstack/react-start";

export type Reservation = {
  ok: boolean;
  error?: string;
  executed?: boolean;
  locked_by_other?: boolean;
  expires_at?: string | null;
  concurrent_viewers?: number;
};

export const startReservation = createServerFn({ method: "POST" })
  .inputValidator((d: { id: string; buyerEmail?: string | null }) => d)
  .handler(async ({ data }): Promise<Reservation> => {
    try {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const { data: res, error } = await supabaseAdmin.rpc("start_deal_reservation" as never, {
        _id: data.id,
        _buyer_email: data.buyerEmail?.trim() || null,
      } as never);
      if (error) return { ok: false, error: error.message };
      return (res ?? { ok: false, error: "no_result" }) as Reservation;
    } catch (e) {
      console.error("[reservation] start failed", e);
      return { ok: false, error: "reservation_failed" };
    }
  });
