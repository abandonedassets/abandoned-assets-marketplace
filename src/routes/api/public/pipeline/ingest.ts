// Stage 1 endpoint — POST /api/public/pipeline/ingest
// Accepts any vendor payload shape, hashes + dedupes, inserts, and immediately
// triggers Stage 2 (algorithmic underwriting) and Stage 3 (dispatch + FBO).
// Optional shared secret via VENDOR_RELAY_SECRET / PIPELINE_INGEST_SECRET.
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/public/pipeline/ingest")({
  server: {
    handlers: {
      GET: async () =>
        Response.json({
          ok: true,
          stage: "ingest",
          accepts:
            "POST { source?, deals: [ { address, city, state, zip, price, arv?, repairs?, sqft?, beds?, baths?, year_built?, apn?, asset_type? } ] }",
        }),
      POST: async ({ request }) => {
        try {
          const secret =
            process.env["PIPELINE_INGEST_SECRET"] || process.env["VENDOR_RELAY_SECRET"] || "";
          if (secret) {
            const url = new URL(request.url);
            const given =
              request.headers.get("x-vendor-secret") ??
              request.headers.get("x-ingest-secret") ??
              url.searchParams.get("secret") ??
              "";
            if (given !== secret)
              return Response.json({ ok: false, error: "unauthorized" }, { status: 401 });
          }

          const raw = (await request.json().catch(() => ({}))) as any;
          const { ingestAssets, extractList } = await import("@/lib/ingest.server");
          const list = extractList(raw);
          if (!list.length)
            return Response.json({ ok: false, error: "empty_payload" }, { status: 400 });

          const source =
            (raw?.source ?? raw?.vendor ?? "").toString().trim() || "pipeline_ingest";
          const result = await ingestAssets(list, source);

          // Chain Stage 2 → Stage 3 inline so no human click is required.
          const { runPipelineChain } = await import("@/lib/pipeline-chain.server");
          const chain = await runPipelineChain({
            underwriteLimit: Math.max(10, result.inserted),
            reason: "ingest",
          });

          return Response.json({ ...result, chain });
        } catch (e) {
          console.error("[pipeline-ingest] unhandled", e);
          return Response.json({ ok: false, error: (e as Error).message }, { status: 200 });
        }
      },
    },
  },
});
