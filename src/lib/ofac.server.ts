// Automated OFAC / SDN sanctions screening.
// Pulls the Treasury SDN + Consolidated lists, caches them in-process, and
// token-matches counterparty entity + signatory names before execution.

type SdnEntry = { name: string; tokens: Set<string>; program: string; type: string };

const SOURCES = [
  "https://www.treasury.gov/ofac/downloads/sdn.csv",
  "https://www.treasury.gov/ofac/downloads/consolidated/cons_prim.csv",
];

const TTL_MS = 6 * 60 * 60 * 1000;
let cache: { at: number; entries: SdnEntry[] } | null = null;

const STOP = new Set([
  "the","and","of","llc","inc","ltd","co","corp","company","group","holdings","trust",
  "lp","llp","plc","sa","gmbh","limited","partners","capital","fund","investments","re",
]);

function norm(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenize(s: string): string[] {
  return norm(s)
    .split(" ")
    .filter((t) => t.length > 2 && !STOP.has(t));
}

function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') {
      if (q && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else q = !q;
    } else if (c === "," && !q) {
      out.push(cur);
      cur = "";
    } else cur += c;
  }
  out.push(cur);
  return out;
}

async function loadList(): Promise<SdnEntry[]> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.entries;
  const entries: SdnEntry[] = [];
  for (const url of SOURCES) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
      if (!res.ok) continue;
      const text = await res.text();
      for (const line of text.split("\n")) {
        if (!line.trim()) continue;
        const cols = parseCsvLine(line);
        const name = (cols[1] ?? "").trim();
        if (!name || name === "-0-") continue;
        const tokens = new Set(tokenize(name));
        if (tokens.size === 0) continue;
        entries.push({
          name,
          tokens,
          type: (cols[2] ?? "").trim(),
          program: (cols[3] ?? "").trim(),
        });
      }
    } catch (e) {
      console.error("[ofac] source failed", url, e);
    }
  }
  if (entries.length === 0) return cache?.entries ?? [];
  cache = { at: Date.now(), entries };
  return entries;
}

export type OfacHit = { list_name: string; program: string; type: string; score: number };
export type OfacResult = {
  status: "Clear" | "Blocked" | "Unavailable";
  screened: string[];
  hits: OfacHit[];
  screened_at: string;
};

/** Screens every supplied party string. Any >=0.85 token overlap is a block. */
export async function screenParties(parties: Array<string | null | undefined>): Promise<OfacResult> {
  const screened = parties.filter((p): p is string => !!p && p.trim().length > 1).map((p) => p.trim());
  const screened_at = new Date().toISOString();
  const list = await loadList();
  if (list.length === 0) return { status: "Unavailable", screened, hits: [], screened_at };

  const hits: OfacHit[] = [];
  for (const party of screened) {
    const toks = tokenize(party);
    if (toks.length === 0) continue;
    for (const e of list) {
      let match = 0;
      for (const t of toks) if (e.tokens.has(t)) match++;
      const score = match / Math.max(toks.length, e.tokens.size);
      if (score >= 0.85) hits.push({ list_name: e.name, program: e.program, type: e.type, score });
      if (hits.length >= 5) break;
    }
  }
  return { status: hits.length ? "Blocked" : "Clear", screened, hits, screened_at };
}
