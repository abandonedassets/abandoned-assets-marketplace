/**
 * Explicitly registered Mercury webhook relay for the Render Nitro runtime.
 * GET is a non-mutating reachability probe; POST forwards the exact signed body.
 */
const SUPABASE_LISTENER =
  "https://midneoocykeoquxkjkrg.supabase.co/functions/v1/mercury-webhook-listener";

export default defineEventHandler(async (event) => {
  const method = getMethod(event);
  if (method === "GET") {
    setHeader(event, "cache-control", "no-store");
    return {
      ok: true,
      service: "mercury-webhook-relay",
      forwardsTo: "supabase-listener",
    };
  }
  if (method !== "POST") {
    setHeader(event, "allow", "GET, POST");
    throw createError({ statusCode: 405, statusMessage: "method_not_allowed" });
  }

  let rawBody: string | undefined;
  try {
    rawBody = await readRawBody(event, false);
  } catch {
    throw createError({ statusCode: 400, statusMessage: "request_body_unreadable" });
  }
  if (rawBody === undefined || rawBody.length === 0) {
    throw createError({ statusCode: 400, statusMessage: "request_body_missing" });
  }

  const signature = getHeader(event, "Mercury-Signature");
  const contentType = getHeader(event, "content-type");
  const headers = new Headers();
  if (signature) headers.set("Mercury-Signature", signature);
  if (contentType) headers.set("content-type", contentType);

  try {
    const upstream = await fetch(SUPABASE_LISTENER, {
      method: "POST",
      headers,
      body: rawBody,
      cache: "no-store",
      signal: AbortSignal.timeout(4500),
    });
    setResponseStatus(event, upstream.status);
    const upstreamType = upstream.headers.get("content-type");
    if (upstreamType) setHeader(event, "content-type", upstreamType);
    setHeader(event, "cache-control", "no-store");
    return await upstream.text();
  } catch {
    throw createError({
      statusCode: 502,
      statusMessage: "supabase_listener_unreachable",
    });
  }
});
