import "./lib/error-capture";

import { consumeLastCapturedError } from "./lib/error-capture";
import { renderErrorPage } from "./lib/error-page";

const PORT = Number(process.env.PORT) || 3000;
console.log(`Clearinghouse server active on port ${PORT}`);

const requiredRuntimeConfig = ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"] as const;
const missingRuntimeConfig = requiredRuntimeConfig.filter(
  (key) => !(process.env[key] ?? "").trim(),
);
console.log(
  "[boot:runtime-config]",
  JSON.stringify({
    node: process.version,
    port: PORT,
    render: Boolean(process.env.RENDER),
    missing: missingRuntimeConfig,
  }),
);

type ServerEntry = {
  fetch: (request: Request, env: unknown, ctx: unknown) => Promise<Response> | Response;
};

let serverEntryPromise: Promise<ServerEntry> | undefined;

import { isClientAbort } from "./lib/is-client-abort";

async function getServerEntry(): Promise<ServerEntry> {
  if (!serverEntryPromise) {
    serverEntryPromise = import("@tanstack/react-start/server-entry").then(
      (m) => (m.default ?? m) as ServerEntry,
    );
  }
  return serverEntryPromise;
}

// h3 swallows in-handler throws into a normal 500 Response with body
// {"unhandled":true,"message":"HTTPError"} — try/catch alone never fires for those.
async function normalizeCatastrophicSsrResponse(
  response: Response,
  request: Request,
): Promise<Response> {
  if (response.status < 500) return response;
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) return response;

  const body = await response.clone().text();
  if (!body.includes('"unhandled":true') || !body.includes('"message":"HTTPError"')) {
    return response;
  }

  const captured = consumeLastCapturedError();
  // Client disconnected mid-request (ECONNRESET / aborted) — not an app error.
  if (request.signal?.aborted || isClientAbort(captured)) {
    return new Response(null, { status: 499 });
  }

  const path = new URL(request.url).pathname;

  // No handler matched this method/path and the route has no component —
  // that is a 405/404, not an app crash. Answer cleanly and stay quiet.
  const msg = captured instanceof Error ? captured.message : String(captured ?? "");
  if (msg.includes("forgot to return a response from your server route handler")) {
    return Response.json(
      { ok: false, error: "method_not_allowed", method: request.method, path },
      { status: 405 },
    );
  }

  console.error(captured ?? new Error(`h3 swallowed SSR error: ${body}`));
  // Server-function / API calls must never receive an HTML error page — the
  // client parses it as JSON, fails, and blanks the screen.
  if (path.startsWith("/_serverFn") || path.startsWith("/api/")) {
    return Response.json({ ok: false, error: "internal_server_error" }, { status: 500 });
  }

  return new Response(renderErrorPage(), {
    status: 500,
    headers: { "content-type": "text/html; charset=utf-8" },
  });

}


// Boot trigger: fire the settlement pipeline once per server instance, on the
// first request after deploy. Fail-forward — never blocks or breaks the response.
let bootSettlement: Promise<unknown> | undefined;
let bootScheduled = false;
function scheduleBootSettlement() {
  if (bootScheduled) return;
  bootScheduled = true;
  setTimeout(fireBootSettlement, 5_000);
}
function fireBootSettlement() {
  if (bootSettlement) return;
  console.log("[boot:settlement] started");
  bootSettlement = (async () => {
    try {
      const mod = await import("./lib/stripe-settlement.server");
      const minted = await mod.mintReceiversForClearedContracts(25);
      console.log("[boot-receivers]", JSON.stringify(minted));
      const report = await mod.runSettlementCycle(50);
      console.log("[boot-settlement]", JSON.stringify(report));
      try {
        const seed = await import("./lib/registry-seed.server");
        console.log("[boot-registry-seed]", JSON.stringify(await seed.bootstrapLiveEcosystem()));
      } catch (e) {
        console.error("[boot-registry-seed] failed", e);
      }
    } catch (e) {
      console.error("[boot-settlement] failed", e);
    }
  })().finally(() => {
    console.log("[boot:settlement] finished");
  });
}

export default {
  async fetch(request: Request, env: unknown, ctx: unknown) {
    // Health check must answer instantly, before any SSR/module graph work.
    // Render kills the container if this ping ever stalls.
    const url = new URL(request.url);
    if (url.pathname === "/api/public/health" || url.pathname === "/healthz") {
      return new Response("OK", {
        status: 200,
        headers: { "content-type": "text/plain", "cache-control": "no-store" },
      });
    }
    // Defer boot work off the request path so it can never stall a response.
    scheduleBootSettlement();
    try {
      const handler = await getServerEntry();
      const response = await handler.fetch(request, env, ctx);
      return await normalizeCatastrophicSsrResponse(response, request);
    } catch (error) {
      // Client disconnected mid-request (node:_http_server abortIncoming) — not an app error.
      if (isClientAbort(error) || request.signal?.aborted) {
        return new Response(null, { status: 499 });
      }
      console.error(error);
      if (url.pathname.startsWith("/_serverFn") || url.pathname.startsWith("/api/")) {
        return Response.json({ ok: false, error: "internal_server_error" }, { status: 500 });
      }
      return new Response(renderErrorPage(), {
        status: 500,
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    }
  },
};
