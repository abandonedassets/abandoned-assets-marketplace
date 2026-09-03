// Cloud-native M2M email dispatch. Resend via the Lovable connector gateway.
// Every outbound message carries machine-readable X-* headers plus a
// structured JSON asset block so institutional acquisition bots can parse it.

const GATEWAY_URL = "https://connector-gateway.lovable.dev/resend";

export type M2MHeaders = Record<string, string>;

export type SendResult =
  | { ok: true; id: string | null }
  | { ok: false; status: number; error: string };

export function senderAddress(): string {
  // Strip zero-width/non-ASCII noise that can creep in from pasted secrets —
  // Resend rejects any `from` value containing non-ASCII characters (422).
  const raw = (process.env.ESCROW_SENDER_EMAIL || "deals@asset-weaver-30.lovable.app")
    .replace(/[^\x20-\x7E]/g, "")
    .trim();
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(raw) ? raw : "deals@asset-weaver-30.lovable.app";
}

export function assetHeaders(input: {
  assetId: string;
  dealType: string;
  assignmentFee: number | null;
  stumpage?: number | null;
  action: string;
  vdrUrl?: string | null;
}): M2MHeaders {
  return {
    "X-Asset-ID": input.assetId,
    "X-Deal-Type": input.dealType,
    "X-Stumpage-Value": input.stumpage ? String(input.stumpage) : "N/A",
    "X-Assignment-Fee": input.assignmentFee ? String(Math.round(input.assignmentFee)) : "0",
    "X-Action-Required": input.action,
    ...(input.vdrUrl ? { "X-VDR-Access": input.vdrUrl } : {}),
  };
}

/** Machine-parsable JSON block appended to every outbound body. */
export function jsonBlock(payload: Record<string, unknown>): string {
  return `<pre style="font:12px ui-monospace,monospace;background:#0b0f14;color:#7ee787;padding:12px;border-radius:6px;white-space:pre-wrap">${JSON.stringify(
    payload,
    null,
    2,
  )}</pre>`;
}

export async function sendM2MEmail(input: {
  to: string | string[];
  subject: string;
  html?: string;
  text?: string;
  headers?: M2MHeaders;
  replyTo?: string;
  /** Direct binary attachments (no links) for institutional intake desks. */
  attachments?: Array<{ filename: string; content_base64: string; content_type?: string }>;
}): Promise<SendResult> {
  const { assertOutboundAllowed, KillSwitchError } = await import("./killswitch.server");
  try {
    await assertOutboundAllowed();
  } catch (e) {
    if (e instanceof KillSwitchError) return { ok: false, status: 503, error: "kill_switch" };
    throw e;
  }

  const lovableKey = process.env.LOVABLE_API_KEY;
  const resendKey = process.env.RESEND_API_KEY;
  if (!lovableKey || !resendKey) return { ok: false, status: 500, error: "email_not_configured" };

  try {
    const res = await fetch(`${GATEWAY_URL}/emails`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${lovableKey}`,
        "X-Connection-Api-Key": resendKey,
      },
      body: JSON.stringify({
        from: `ReelEdge Acquisitions <${senderAddress()}>`,
        to: Array.isArray(input.to) ? input.to : [input.to],
        subject: input.subject,
        ...(input.text ? { text: input.text } : {}),
        ...(input.html ? { html: input.html } : {}),
        headers: input.headers ?? {},
        ...(input.attachments?.length
          ? {
              attachments: input.attachments.map((a) => ({
                filename: a.filename,
                content: a.content_base64,
                ...(a.content_type ? { content_type: a.content_type } : {}),
              })),
            }
          : {}),
        reply_to: input.replyTo ?? senderAddress(),
      }),
    });
    if (!res.ok) {
      const body = await res.text();
      console.error(`[sendM2MEmail] provider failed [${res.status}]: ${body}`);
      return { ok: false, status: res.status, error: body.slice(0, 400) };
    }
    const json: any = await res.json().catch(() => ({}));
    return { ok: true, id: json?.id ?? null };
  } catch (e: any) {
    console.error("[sendM2MEmail] transport error:", e);
    return { ok: false, status: 502, error: String(e?.message ?? e) };
  }
}

/** Deterministic regex intent match with an LLM fallback. Never throws. */
export async function classifyIntent(text: string): Promise<string> {
  const t = (text || "").toLowerCase();
  const contract =
    /(send|where).{0,20}(the )?contract|i'?ll take it|i will take it|we'?ll take it|proceed|let'?s close|send (me )?(the )?(docs|paperwork|agreement)/;
  if (contract.test(t)) return "CONTRACT_REQUEST";
  if (/\b(pass|not interested|no thanks|decline)\b/.test(t)) return "DECLINE";
  if (/\?/.test(t) && t.length < 2000) {
    const llm = await llmIntent(text);
    if (llm) return llm;
  }
  return "UNKNOWN";
}

async function llmIntent(text: string): Promise<string | null> {
  const key = process.env.LOVABLE_API_KEY;
  if (!key) return null;
  try {
    const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Lovable-API-Key": key },
      body: JSON.stringify({
        model: "google/gemini-3.6-flash",
        messages: [
          {
            role: "system",
            content:
              "Classify a real-estate buyer email. Reply with exactly one token: CONTRACT_REQUEST, DECLINE, QUESTION, or UNKNOWN.",
          },
          { role: "user", content: text.slice(0, 4000) },
        ],
      }),
    });
    if (!res.ok) return null;
    const j: any = await res.json();
    const out = String(j?.choices?.[0]?.message?.content ?? "")
      .trim()
      .toUpperCase();
    return ["CONTRACT_REQUEST", "DECLINE", "QUESTION", "UNKNOWN"].includes(out) ? out : null;
  } catch {
    return null;
  }
}
