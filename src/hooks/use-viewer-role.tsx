import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

/**
 * Read-only seat detection. Returns true when the signed-in user holds the
 * 'viewer' role and no elevated role. Execution controls must be hidden.
 * DB-level RLS remains the real enforcement boundary.
 */
export function useIsViewer() {
  const [isViewer, setIsViewer] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      const { data: auth } = await supabase.auth.getUser();
      if (!auth.user) {
        if (alive) setLoaded(true);
        return;
      }
      const { data } = await supabase
        .from("user_roles")
        .select("role")
        .eq("user_id", auth.user.id);
      const roles = (data ?? []).map((r: { role: string }) => r.role);
      if (!alive) return;
      setIsViewer(roles.includes("viewer") && !roles.includes("admin"));
      setLoaded(true);
    })();
    return () => {
      alive = false;
    };
  }, []);

  return { isViewer, loaded };
}
