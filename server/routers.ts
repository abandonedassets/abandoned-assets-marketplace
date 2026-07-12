import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { publicProcedure, protectedProcedure, router } from "./_core/trpc";
import { z } from "zod";
import { createClient } from "@supabase/supabase-js";

const SB_URL = process.env.SUPABASE_URL || "";
const SB_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";

function sb() {
  return createClient(SB_URL, SB_KEY);
}

export const appRouter = router({
  system: systemRouter,
  auth: router({
    me: publicProcedure.query(opts => opts.ctx.user),
    logout: publicProcedure.mutation(({ ctx }) => {
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
      return { success: true } as const;
    }),
  }),

  deals: router({
    feed: publicProcedure.query(async ({ ctx }) => {
      const supabase = sb();
      const { data, error } = await supabase.from("deals_master")
        .select("id,address,deal_grade,deal_health_score,gross_arbitrage_spread,status,market,cost_basis,arv_projection,last_ingested_at")
        .order("last_ingested_at", { ascending: false })
        .limit(50);
      if (error) throw new Error("Database connection failed");
      return { items: data || [] };
    }),
  }),

  seller: router({
    submit: publicProcedure
      .input(z.object({
        address: z.string(),
        price: z.number().optional(),
        arv: z.number().optional(),
        apn: z.string().optional(),
      }))
      .mutation(async ({ input }) => {
        const LAND = /(land|lot|timber|acreage|parcel|vacant|wooded|forest)/i;
        const isLand = LAND.test(input.address);
        let pipeline = "ironclad";
        if (!isLand) {
          if ((input.price || 0) >= 100000) {
            pipeline = "juggernaut";
          } else {
            const digits = (input.apn || "0").replace(/\D/g, "");
            const last = parseInt(digits.slice(-1) || "0", 10);
            pipeline = last % 2 === 1 ? "juggernaut" : "ironclad";
          }
        }
        const { data, error } = await sb().from("properties_raw").insert({
          title: input.address,
          address: input.address,
          price: input.price || null,
          arv: input.arv || null,
          apn: input.apn || null,
          pipeline,
          has_land_marker: isLand,
          motivation_score: pipeline === "juggernaut" ? 80 : 70,
          source: "seller_submission",
          status: "new",
        }).select();
        if (error) throw error;
        return { pipeline, data: data?.[0] || null };
      }),
  }),
});

export type AppRouter = typeof appRouter;
