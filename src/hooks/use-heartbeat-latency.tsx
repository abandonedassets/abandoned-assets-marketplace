import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

const THRESHOLD_MS = 500;
const PING_INTERVAL_MS = 3000;

export type HeartbeatState = {
  /** Last measured round-trip latency in ms, null while unknown. */
  latencyMs: number | null;
  /** True when the socket is connected AND latency is under 500ms. */
  live: boolean;
  /** True when the connection dropped or lagged past 500ms — suspend execution surfaces. */
  stale: boolean;
  reason: "ok" | "connecting" | "disconnected" | "lagged";
};

/**
 * Stale-State Circuit Breaker.
 * Tracks realtime WebSocket heartbeat RTT. Any drop or >500ms lag flips `stale`,
 * which callers use to suspend REVERSE_STRIKE_READY assets so no algo can wire
 * against a ghost state during a micro-disconnect.
 */
export function useHeartbeatLatency(): HeartbeatState {
  const [state, setState] = useState<HeartbeatState>({
    latencyMs: null,
    live: false,
    stale: true,
    reason: "connecting",
  });
  const pendingRef = useRef<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setInterval> | null = null;

    const channel = supabase.channel("hb-circuit-breaker", {
      config: { broadcast: { self: true } },
    });

    const apply = (next: HeartbeatState) => {
      if (!cancelled) setState(next);
    };

    channel
      .on("broadcast", { event: "ping" }, (msg: { payload?: { t?: number } }) => {
        const sent = msg.payload?.t ?? pendingRef.current;
        if (!sent) return;
        pendingRef.current = null;
        const rtt = Date.now() - sent;
        apply({
          latencyMs: rtt,
          live: rtt <= THRESHOLD_MS,
          stale: rtt > THRESHOLD_MS,
          reason: rtt > THRESHOLD_MS ? "lagged" : "ok",
        });
      })
      .subscribe((status) => {
        if (status === "SUBSCRIBED") {
          timer = setInterval(() => {
            // Unanswered previous ping => the socket is dead or lagging past budget.
            if (pendingRef.current && Date.now() - pendingRef.current > THRESHOLD_MS) {
              apply({
                latencyMs: Date.now() - pendingRef.current,
                live: false,
                stale: true,
                reason: "disconnected",
              });
            }
            const t = Date.now();
            pendingRef.current = t;
            void channel.send({ type: "broadcast", event: "ping", payload: { t } });
          }, PING_INTERVAL_MS);

          const t = Date.now();
          pendingRef.current = t;
          void channel.send({ type: "broadcast", event: "ping", payload: { t } });
        } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
          apply({ latencyMs: null, live: false, stale: true, reason: "disconnected" });
        }
      });

    return () => {
      cancelled = true;
      if (timer) clearInterval(timer);
      void supabase.removeChannel(channel);
    };
  }, []);

  return state;
}
