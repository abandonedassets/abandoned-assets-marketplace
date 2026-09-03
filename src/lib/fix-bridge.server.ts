// REST-to-FIX 4.4 translation module.
// Prime brokers speak FIX; the platform speaks JSON. This maps both ways.
//   Inbound  : NewOrderSingle (35=D)  -> internal execute payload
//   Outbound : ExecutionReport (35=8) -> fill / reject confirmation

import type { TapeAsset } from "./m2m-tape.server";

const SOH = "\u0001";

export function parseFix(raw: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of raw.split(/[\u0001|]/)) {
    const i = part.indexOf("=");
    if (i > 0) out[part.slice(0, i).trim()] = part.slice(i + 1);
  }
  return out;
}

function checksum(msg: string) {
  let sum = 0;
  for (let i = 0; i < msg.length; i++) sum += msg.charCodeAt(i);
  return String(sum % 256).padStart(3, "0");
}

export function buildFix(tags: Array<[number, string | number]>, msgType: string) {
  const now = new Date()
    .toISOString()
    .replace(/[-:]/g, "")
    .replace("T", "-")
    .slice(0, 21);
  const bodyTags: Array<[number, string | number]> = [
    [35, msgType],
    [49, "ABANDONEDASSET"],
    [56, "COUNTERPARTY"],
    [52, now],
    ...tags,
  ];
  const body = bodyTags.map(([t, v]) => `${t}=${v}`).join(SOH) + SOH;
  const head = `8=FIX.4.4${SOH}9=${body.length}${SOH}`;
  const msg = head + body;
  return `${msg}10=${checksum(msg)}${SOH}`;
}

/** NewOrderSingle -> internal execution instruction. */
export function fixToExecute(raw: string) {
  const f = parseFix(raw);
  const msgType = f["35"];
  if (msgType !== "D")
    return { ok: false as const, error: "unsupported_msgtype", msg_type: msgType ?? null };
  const dealId = (f["55"] ?? f["48"] ?? "").trim(); // Symbol / SecurityID
  const clOrdId = (f["11"] ?? "").trim(); // client order id == idempotency key
  if (!/^[0-9a-f-]{36}$/i.test(dealId))
    return { ok: false as const, error: "invalid_symbol" };
  if (!clOrdId) return { ok: false as const, error: "missing_cl_ord_id" };
  return {
    ok: true as const,
    clOrdId,
    payload: {
      deal_id: dealId,
      max_assignment_fee: Number(f["44"] ?? 0) || 0, // Price as fee limit
      signature: clOrdId,
    },
  };
}

/** Execution result -> ExecutionReport. */
export function executeToFix(
  clOrdId: string,
  result: Record<string, any>,
  accepted: boolean,
) {
  return buildFix(
    [
      [11, clOrdId],
      [17, `${clOrdId}-1`],
      [150, accepted ? "F" : "8"], // Fill / Rejected
      [39, accepted ? "2" : "8"],
      [55, String(result["deal_id"] ?? "")],
      [32, accepted ? 1 : 0],
      [31, Number(result["assignment_fee"] ?? 0)],
      [151, 0],
      [14, accepted ? 1 : 0],
      [58, accepted ? String(result["memo_id"] ?? "FILLED") : String(result["error"] ?? result["reason"] ?? "REJECTED")],
    ],
    "8",
  );
}

/** Tape snapshot -> MarketDataSnapshot-ish stream of Security definitions. */
export function tapeToFix(assets: TapeAsset[]) {
  return assets
    .map((a) =>
      buildFix(
        [
          [55, a.deal_id],
          [48, a.parcel_id ?? ""],
          [22, "PARCEL"],
          [44, a.assignment_fee],
          [15, "USD"],
          [167, "REALESTATE"],
          [207, a.state ?? ""],
          [58, `${a.asset_class ?? "ASSET"}|ARV=${a.arv ?? 0}|TITLE=${a.title_clean ? "CLEAN" : "ENC"}`],
        ],
        "d",
      ),
    )
    .join("\n");
}
