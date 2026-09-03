import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

/** Pinned live diagnostic trap-check: House-Bid / Locked-Escrow-Pending counts. */
export function SysChk() {
  const { data } = useQuery({
    queryKey: ["sys-chk"],
    queryFn: async () => {
      const [hb, lep] = await Promise.all([
        supabase
          .from("closing_pipeline_items")
          .select("*", { count: "exact", head: true })
          .eq("status", "House-Bid"),
        supabase
          .from("closing_pipeline_items")
          .select("*", { count: "exact", head: true })
          .eq("status", "Locked-Escrow-Pending"),
      ]);
      return `SYS_CHK: ${hb.count ?? 0} / ${lep.count ?? 0}`;
    },
    refetchInterval: 30_000,
  });

  return (
    <div className="pointer-events-none fixed bottom-1 right-2 z-50 font-mono text-[10px] tabular-nums text-zinc-500">
      {data ?? "SYS_CHK: — / —"}
    </div>
  );
}
