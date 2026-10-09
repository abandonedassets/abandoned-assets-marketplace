/**
 * Mercury webhook relay.
 *
 * Forwards the exact request body and Mercury-Signature header to the
 * Supabase listener. This route does not parse events, mutate financial
 * state, or initiate payments. Signature verification and staging remain
 * exclusively in the Supabase listener.
 */
const SUPABASE_LISTENER =
  'https://midneoocykeoquxkjkrg.supabase.co/functions/v1/mercury-webhook-listener';

export default defineEventHandler(async (event) => {
  let rawBody: string | undefined;
  try {
    // Preserve the raw JSON text; never parse and re-serialize a signed body.
    rawBody = await readRawBody(event, false);
  } catch {
    throw createError({ statusCode: 400, statusMessage: 'request_body_unreadable' });
  }

  if (rawBody === undefined || rawBody.length === 0) {
    throw createError({ statusCode: 400, statusMessage: 'request_body_missing' });
  }

  const signature = getHeader(event, 'Mercury-Signature');
  const contentType = getHeader(event, 'content-type');
  const headers = new Headers();
  if (signature) headers.set('Mercury-Signature', signature);
  if (contentType) headers.set('content-type', contentType);

  try {
    const upstream = await fetch(SUPABASE_LISTENER, {
      method: 'POST',
      headers,
      body: rawBody,
      cache: 'no-store',
      signal: AbortSignal.timeout(4500),
    });

    setResponseStatus(event, upstream.status);
    const upstreamType = upstream.headers.get('content-type');
    if (upstreamType) setHeader(event, 'content-type', upstreamType);
    setHeader(event, 'cache-control', 'no-store');
    return await upstream.text();
  } catch {
    // A 5xx response permits Mercury to retry. Do not log payloads or secrets.
    throw createError({
      statusCode: 502,
      statusMessage: 'supabase_listener_unreachable',
    });
  }
});
