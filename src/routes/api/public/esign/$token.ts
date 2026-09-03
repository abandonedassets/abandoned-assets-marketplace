// Tokenized e-signature portal API: GET contract state, POST inline signature.
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/public/esign/$token")({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        const { getContract } = await import("@/lib/esign.server");
        const c = await getContract(params.token ?? "");
        if (!c) return Response.json({ error: "not_found" }, { status: 404 });
        const { trackConversionAsync } = await import("@/lib/telemetry.server");
        trackConversionAsync({
          event: "ESIGN_LANDED",
          pipelineItemId: (c as any)?.pipeline_item_id ?? (c as any)?.deal?.id ?? null,
          buyerEmail: (c as any)?.buyer_email ?? null,
          channel: "esign_portal",
          request,
        });
        return Response.json(c, { headers: { "Cache-Control": "no-store" } });
      },

      POST: async ({ request, params }) => {
        let body: any = {};
        try {
          body = await request.json();
        } catch {}
        const name = typeof body?.signerName === "string" ? body.signerName : "";
        const entity = typeof body?.buyerEntity === "string" ? body.buyerEntity : "";
        const w9Name = typeof body?.w9LegalName === "string" ? body.w9LegalName : "";
        const w9Class =
          typeof body?.w9TaxClassification === "string" ? body.w9TaxClassification : "";
        const w9Tin = typeof body?.w9Tin === "string" ? body.w9Tin : "";
        if (name.trim().length < 2)
          return Response.json({ error: "signer_name_required" }, { status: 400 });
        if (entity.trim().length < 2)
          return Response.json({ error: "buyer_entity_required" }, { status: 400 });
        if (w9Name.trim().length < 2 || !w9Class.trim() || w9Tin.replace(/\D/g, "").length !== 9)
          return Response.json({ error: "w9_required" }, { status: 400 });
        const { signContract } = await import("@/lib/esign.server");
        const r = await signContract({
          token: params.token ?? "",
          signerName: name,
          buyerEntity: entity,
          w9LegalName: w9Name,
          w9TaxClassification: w9Class,
          w9Tin,
          ip: request.headers.get("cf-connecting-ip") ?? request.headers.get("x-forwarded-for"),
          userAgent: request.headers.get("user-agent"),
          deviceFingerprint:
            typeof body?.deviceFingerprint === "string" ? body.deviceFingerprint : null,
        });

        if (r.ok) {
          const { trackConversionAsync } = await import("@/lib/telemetry.server");
          trackConversionAsync({
            event: "ESIGN_SIGNED",
            pipelineItemId: (r as any)?.pipelineItemId ?? null,
            buyerEntity: undefined,
            channel: "esign_portal",
            request,
          } as any);
        }
        return Response.json(r, { status: r.ok ? 200 : 400 });
      },

    },
  },
});
