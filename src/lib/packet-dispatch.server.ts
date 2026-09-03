// Institutional Dispatch Worker.
// Anti-quarantine email syntax ([ACQUISITIONS-INTAKE] ID-XXXXXX + un-linked direct
// binary attachments) plus enterprise sinks (authenticated multipart POST and
// drop-monitored SFTP relays). Fail-forward: never throws into the pipeline.

import { createHmac } from "crypto";
import { buildPacketArtifacts, type PacketArtifact } from "./packet-builder.server";
import { buildManifest, manifestArtifact, type PacketManifest } from "./packet-manifest.server";

export type PacketSink = {
  name: string;
  kind: "MULTIPART_POST" | "SFTP_RELAY";
  url: string;
  auth_header?: string | null;
  /** SFTP relay only: drop directory monitored by the counterparty. */
  drop_path?: string | null;
};

const b64 = (bytes: Uint8Array) => Buffer.from(bytes).toString("base64");

export async function loadPacketSinks(): Promise<PacketSink[]> {
  const out: PacketSink[] = [];
  const raw = process.env["PACKET_SINKS"] ?? "";
  if (raw.trim()) {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) out.push(...parsed);
    } catch (e) {
      console.error("[packet-dispatch] PACKET_SINKS parse failed", e);
    }
  }
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data } = await supabaseAdmin
      .from("system_config")
      .select("value")
      .eq("key", "packet_sinks")
      .maybeSingle();
    const val = (data as any)?.value;
    if (Array.isArray(val)) out.push(...val);
  } catch (e) {
    console.error("[packet-dispatch] sink config load failed", e);
  }
  return out.filter((s) => s?.url);
}

/** Strict transactional subject syntax institutional filters whitelist. */
export function intakeSubject(manifest: PacketManifest, deal: Record<string, any>): string {
  const zip = deal["zip"] ?? "NA";
  const state = deal["state"] ?? "NA";
  return `[ACQUISITIONS-INTAKE] ${manifest.packet_id} | ${state}-${zip} | ${manifest.components.length} ARTIFACTS | HASH-${manifest.merkle_root.slice(0, 10).toUpperCase()}`;
}

/** Plain-text body only: zero tracking links, zero images, zero redirects. */
export function intakeBody(manifest: PacketManifest, deal: Record<string, any>): string {
  return [
    `PACKET_ID: ${manifest.packet_id}`,
    `DEAL_ID: ${manifest.deal_id}`,
    `GENERATED_AT: ${manifest.generated_at}`,
    `MERKLE_ROOT: ${manifest.merkle_root}`,
    `SIGNATURE_ALG: ${manifest.signature.alg}  KEY_ID: ${manifest.signature.key_id}`,
    "",
    "ASSET:",
    `  ADDRESS: ${deal["address"] ?? "N/A"}`,
    `  CITY_STATE_ZIP: ${deal["city"] ?? "N/A"}, ${deal["state"] ?? "N/A"} ${deal["zip"] ?? "N/A"}`,
    `  APN: ${deal["apn"] ?? "N/A"}`,
    `  CONTRACT_PRICE: ${Math.round(Number(deal["base_contract_price"] ?? 0))}`,
    `  ASSIGNMENT_FEE: ${Math.round(Number(deal["optimized_acquisition_premium"] ?? 0))}`,
    `  TITLE_STATUS: ${deal["title_status"] ?? "Pending"}`,
    "",
    "ATTACHED COMPONENTS (direct binary, no links):",
    ...manifest.components.map((c) => `  ${c.role}  ${c.filename}  sha256=${c.sha256}`),
    "",
    "Manifest is HMAC-SHA256 signed. Verify merkle_root against component digests.",
    "",
    "MACHINE ACKNOWLEDGEMENT (closes the transaction gate automatically):",
    `  POST ${ackEndpoint()}`,
    "  CONTENT-TYPE: application/json",
    "  BODY: {",
    `    "deal_id": "${manifest.deal_id}",`,
    `    "packet_id": "${manifest.packet_id}",`,
    `    "ack_signature": "${ackSignature(manifest.deal_id, manifest.packet_id)}",`,
    '    "verified_counterparty_id": "<your entity id>",',
    '    "signed_contract_hash": "<sha256 of executed agreement>",',
    '    "title_escrow_file_number": "<escrow file no.>"',
    "  }",
    "  Any subset of the three verified fields resolves its corresponding gate.",
    "ReelEdge Acquisitions",
  ].join("\n");
}

/** Public sink URL the counterparty posts its acknowledgement to. */
export function ackEndpoint(): string {
  const base =
    process.env["PUBLIC_APP_URL"] ||
    process.env["APP_PUBLIC_URL"] ||
    "https://asset-weaver-30.lovable.app";
  return `${base.replace(/\/+$/, "")}/api/public/hooks/packet-ack`;
}

/** Deal+packet scoped capability token; without it the sink rejects the post. */
export function ackSignature(dealId: string, packetId: string): string {
  const key =
    process.env["PACKET_SIGNING_KEY"] ||
    process.env["M2M_HMAC_SECRET"] ||
    process.env["SUPABASE_SERVICE_ROLE_KEY"] ||
    "reeledge-packet-dev-key";
  return createHmac("sha256", key).update(`ack:${dealId}:${packetId}`).digest("hex");
}

/** Build the full signed packet for one deal. */
export async function buildPacket(deal: Record<string, any>) {
  const artifacts = await buildPacketArtifacts(deal);
  const manifest = buildManifest(String(deal["id"]), artifacts, {
    address: deal["address"] ?? null,
    apn: deal["apn"] ?? null,
    contract_price: Number(deal["base_contract_price"] ?? 0),
    assignment_fee: Number(deal["optimized_acquisition_premium"] ?? 0),
  });
  const all: PacketArtifact[] = [manifestArtifact(manifest), ...artifacts];
  return { manifest, artifacts: all };
}

/** Push the packet to one enterprise sink. */
export async function pushToSink(
  sink: PacketSink,
  manifest: PacketManifest,
  artifacts: PacketArtifact[],
): Promise<{ name: string; ok: boolean; status?: number; error?: string }> {
  try {
    const headers: Record<string, string> = {
      "X-Packet-Id": manifest.packet_id,
      "X-Deal-Id": manifest.deal_id,
      "X-Manifest-Merkle-Root": manifest.merkle_root,
      "X-Manifest-Signature": manifest.signature.value,
      "X-Manifest-Key-Id": manifest.signature.key_id,
      ...(sink.auth_header ? { Authorization: sink.auth_header } : {}),
    };

    if (sink.kind === "SFTP_RELAY") {
      // Worker runtimes cannot open raw SSH sockets; drop-monitored relays expose
      // an authenticated HTTPS drop endpoint that writes into the SFTP directory.
      const res = await fetch(sink.url, {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify({
          drop_path: sink.drop_path ?? `/inbound/${manifest.packet_id}`,
          manifest,
          files: artifacts.map((a) => ({
            filename: a.filename,
            content_type: a.content_type,
            content_base64: b64(a.bytes),
          })),
        }),
      });
      return { name: sink.name, ok: res.ok, status: res.status };
    }

    const form = new FormData();
    form.append("manifest", JSON.stringify(manifest));
    for (const a of artifacts)
      form.append(
        "files",
        new Blob([a.bytes as unknown as ArrayBuffer], { type: a.content_type }),
        a.filename,
      );
    const res = await fetch(sink.url, { method: "POST", headers, body: form });
    return { name: sink.name, ok: res.ok, status: res.status };
  } catch (e) {
    return { name: sink.name, ok: false, error: String(e) };
  }
}

/** Email + sink dispatch for one deal. */
export async function dispatchPacket(deal: Record<string, any>, recipients: string[]) {
  const { manifest, artifacts } = await buildPacket(deal);
  const subject = intakeSubject(manifest, deal);
  const text = intakeBody(manifest, deal);
  const emailed: Array<{ to: string; ok: boolean; error?: string }> = [];

  if (recipients.length) {
    const { sendM2MEmail } = await import("./email.server");
    for (const to of recipients) {
      const res = await sendM2MEmail({
        to,
        subject,
        text,
        headers: {
          "X-Packet-Id": manifest.packet_id,
          "X-Deal-Id": manifest.deal_id,
          "X-Manifest-Merkle-Root": manifest.merkle_root,
          "X-Manifest-Signature": manifest.signature.value,
        },
        attachments: artifacts.map((a) => ({
          filename: a.filename,
          content_base64: b64(a.bytes),
          content_type: a.content_type,
        })),
      });
      emailed.push({ to, ok: res.ok, ...(res.ok ? {} : { error: res.error }) });
    }
  }

  const sinks = await loadPacketSinks();
  const sinkResults = [];
  for (const sink of sinks) sinkResults.push(await pushToSink(sink, manifest, artifacts));

  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await supabaseAdmin.from("outbound_alert_log" as never).insert({
      pipeline_item_id: manifest.deal_id,
      channel: "institutional_packet",
      target: [...recipients, ...sinks.map((s) => s.name)].join(",") || "none",
      status: emailed.some((e) => e.ok) || sinkResults.some((s) => s.ok) ? "sent" : "failed",
      payload: {
        packet_id: manifest.packet_id,
        merkle_root: manifest.merkle_root,
        components: manifest.components.map((c) => c.filename),
        emailed,
        sinks: sinkResults,
      } as never,
    } as never);
  } catch (e) {
    console.error("[packet-dispatch] log failed", e);
  }

  return {
    packet_id: manifest.packet_id,
    merkle_root: manifest.merkle_root,
    components: manifest.components.length,
    emailed,
    sinks: sinkResults,
  };
}

/** Bounded batch worker: packet-dispatch the highest-margin un-packeted deals. */
export async function runPacketDispatchWorker(limit = 10) {
  const started = Date.now();
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: deals } = await supabaseAdmin
      .from("closing_pipeline_items")
      .select("*")
      .eq("status", "Webhook_Dispatched")
      .is("cleared_at", null)
      .order("optimized_acquisition_premium", { ascending: false })
      .limit(Math.min(limit, 25));

    const { data: buyers } = await supabaseAdmin
      .from("buyer_waitlist")
      .select("contact_email")
      .not("contact_email", "is", null)
      .limit(25);
    const { isSyntheticContact } = await import("@/lib/endpoint-verify.server");
    const recipients = Array.from(
      new Set(((buyers ?? []) as any[]).map((b) => String(b.contact_email)).filter(Boolean)),
    ).filter((e) => !isSyntheticContact(e));
    if (recipients.length === 0) {
      return {
        ok: false,
        error: "no_live_counterparty",
        dispatched: 0,
        latency_ms: Date.now() - started,
      };
    }


    const results = [];
    for (const d of (deals ?? []) as any[]) {
      try {
        results.push(await dispatchPacket(d, recipients));
      } catch (e) {
        console.error("[packet-dispatch] deal failed", d?.id, e);
      }
    }
    return { ok: true, dispatched: results.length, results, latency_ms: Date.now() - started };
  } catch (e) {
    console.error("[packet-dispatch] worker failed", e);
    return { ok: false, error: String(e), latency_ms: Date.now() - started };
  }
}
