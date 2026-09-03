import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

/**
 * Refreshes terminal queries only when the database actually broadcasts a
 * change. Replaces blind interval polling — quiet DB means zero refetches.
 */
export function useRealtimeRefresh(queryKeyPrefix: string) {
  const qc = useQueryClient();

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const channel = supabase
      .channel(`refresh-${queryKeyPrefix}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "closing_pipeline_items" },
        () => {
          // Coalesce bursts: one refetch per 1s of backend activity.
          if (timer) return;
          timer = setTimeout(() => {
            timer = null;
            void qc.invalidateQueries({ queryKey: [queryKeyPrefix] });
          }, 1000);
        },
      )
      .subscribe();

    return () => {
      if (timer) clearTimeout(timer);
      void supabase.removeChannel(channel);
    };
  }, [qc, queryKeyPrefix]);
}
