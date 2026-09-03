// Streams the capitalization ledger as CSV for accountants / auditors.
import { createFileRoute } from "@tanstack/react-router";

type Ev = { t: string; h: string; m: string; s: string; f: number; hrs: number; v: number };

const esc = (v: string) => `"${String(v).replace(/"/g, '""')}"`;

export const Route = createFileRoute("/api/admin/ledger/export-csv")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        try {
          const res = await fetch(new URL("/ledger/ledger_summary.json", request.url).toString());
          if (!res.ok) return new Response("ledger unavailable", { status: 503 });
          const ledger = (await res.json()) as { hourly_rate_usd: number; events: Ev[] };
          const rate = ledger.hourly_rate_usd ?? 150;
          const csv = [
            "timestamp,commit_hash,feature_scope,subject,files_modified,hours_logged,hourly_rate_usd,capitalized_value_usd",
            ...ledger.events.map((e) =>
              [e.t, e.h, esc(e.m), esc(e.s), e.f, e.hrs, rate, e.v].join(","),
            ),
          ].join("\n");

          return new Response(csv, {
            headers: {
              "Content-Type": "text/csv; charset=utf-8",
              "Content-Disposition": `attachment; filename="capitalization_ledger_${new Date().toISOString().slice(0, 10)}.csv"`,
              "Cache-Control": "no-store",
            },
          });
        } catch (e) {
          return new Response(e instanceof Error ? e.message : "error", { status: 500 });
        }
      },
    },
  },
});
