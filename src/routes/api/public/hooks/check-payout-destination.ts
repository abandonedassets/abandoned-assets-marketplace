import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

const querySchema = z.object({
  secret: z.string().min(1),
});

// Confirms the live payout destination: the Bluevine business account.
// Stripe is fully removed from the settlement path.
export const Route = createFileRoute("/api/public/hooks/check-payout-destination")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const query = querySchema.safeParse({
          secret: url.searchParams.get("secret"),
        });

        if (!query.success) {
          return Response.json({ error: "Missing ?secret= parameter" }, { status: 400 });
        }

        const expectedSecret = process.env["PAYOUT_DESTINATION_SECRET"];
        if (!expectedSecret || query.data.secret !== expectedSecret) {
          return Response.json({ error: "Unauthorized" }, { status: 401 });
        }

        const { bluevineStatus } = await import("@/lib/bluevine-rails.server");
        const { wireConfig, BENEFICIARY_NAME } = await import("@/lib/bluevine.server");
        const status = await bluevineStatus();
        const cfg = wireConfig();

        if (!status.coordinates_ready) {
          return Response.json(
            {
              error: "Bluevine coordinates not configured",
              action:
                "Set BLUEVINE_ROUTING_NUMBER and BLUEVINE_ACCOUNT_NUMBER in project secrets.",
            },
            { status: 404 },
          );
        }

        return Response.json({
          rail: "bluevine",
          beneficiary: BENEFICIARY_NAME,
          bank_name: status.bank,
          bank_address: cfg.address,
          last4: status.account_last4,
          routing_prefix: status.routing_prefix,
          payout_status: {
            enabled: true,
            rest_facility_bound: status.rest_facility_bound,
            method: status.rest_facility_bound ? "api_wire" : "fedwire_instruction",
          },
        });
      },
    },
  },
});
