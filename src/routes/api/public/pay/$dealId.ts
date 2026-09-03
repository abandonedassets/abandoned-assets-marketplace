// Pass C: Self-healing public payment redirect.
// GET /api/public/pay/$dealId → 302 to the live Bluevine settlement instruction URL.
// Reuses the deal's stored session if still valid; otherwise transparently
// mints a fresh one. Invalid/missing/cleared deals redirect to the terminal
// with an explicit error flag — never a raw error page.

import { createFileRoute } from "@tanstack/react-router";

function redirect(url: string) {
  return new Response(null, {
    status: 302,
    headers: {
      Location: url,
      "Cache-Control": "no-store",
    },
  });
}

export const Route = createFileRoute("/api/public/pay/$dealId")({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        const url = new URL(request.url);
        const origin = `${url.protocol}//${url.host}`;
        const dealId = (params.dealId ?? "").trim();
        const home = (flag: string) =>
          redirect(`${origin}/admin/terminal?pay_error=${flag}`);

        if (!dealId) return home("missing_deal");

        try {
          const { mintOrReuseCheckoutSession } = await import(
            "@/lib/checkout.server"
          );
          const result = await mintOrReuseCheckoutSession(dealId, origin);
          if (!result.ok) return home(result.error);
          return redirect(result.url);
        } catch (e: any) {
          return home("unhandled");
        }
      },
    },
  },
});
