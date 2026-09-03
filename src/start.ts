import { createStart, createMiddleware } from "@tanstack/react-start";

import { renderErrorPage } from "./lib/error-page";
import { isClientAbort } from "./lib/is-client-abort";
import { attachSupabaseAuth } from "@/integrations/supabase/auth-attacher";

const errorMiddleware = createMiddleware().server(async ({ next, request }) => {
  try {
    return await next();
  } catch (error) {
    if (error != null && typeof error === "object" && "statusCode" in error) {
      throw error;
    }
    // Client disconnect (node:_http_server "aborted") — not an app failure.
    if (isClientAbort(error)) {
      return new Response(null, { status: 499 });
    }
    console.error(error);
    const path = new URL(request.url).pathname;
    const isApi = path.startsWith("/api/") || path.startsWith("/_serverFn");
    return isApi
      ? Response.json({ ok: false, error: "internal_server_error" }, { status: 500 })
      : new Response(renderErrorPage(), {
          status: 500,
          headers: { "content-type": "text/html; charset=utf-8" },
        });
  }
});

export const startInstance = createStart(() => ({
  functionMiddleware: [attachSupabaseAuth],
  requestMiddleware: [errorMiddleware],
}));
