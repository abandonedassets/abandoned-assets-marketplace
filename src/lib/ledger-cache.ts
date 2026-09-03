// Offline-resilient ledger cache: IndexedDB primary, localStorage fallback.
import { get, set } from "idb-keyval";

export type LedgerEvent = {
  t: string;
  h: string;
  m: string;
  s: string;
  f: number;
  hrs: number;
  v: number;
};

export type LedgerSummary = {
  generated_at: string;
  hourly_rate_usd: number;
  management_authorization_date: string | null;
  first_commit: string | null;
  last_commit: string | null;
  total_commits: number;
  total_hours_logged: number;
  total_capitalized_value_usd: number;
  milestone_summary: Array<{
    milestone: string;
    commits: number;
    hours_logged: number;
    capitalized_value_usd: number;
  }>;
  events: LedgerEvent[];
};

const KEY = "capitalization-ledger-v1";

async function readCache(): Promise<LedgerSummary | null> {
  try {
    const idb = await get<LedgerSummary>(KEY);
    if (idb) return idb;
  } catch {
    /* fail-forward to localStorage */
  }
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as LedgerSummary) : null;
  } catch {
    return null;
  }
}

async function writeCache(data: LedgerSummary) {
  try {
    await set(KEY, data);
  } catch {
    /* ignore */
  }
  try {
    localStorage.setItem(KEY, JSON.stringify(data));
  } catch {
    /* quota — IndexedDB copy still stands */
  }
}

/** Network-first with an offline cache fallback. Never throws when cached. */
export async function loadLedger(): Promise<{ data: LedgerSummary; offline: boolean }> {
  try {
    const res = await fetch("/ledger/ledger_summary.json", { cache: "no-cache" });
    if (!res.ok) throw new Error(String(res.status));
    const data = (await res.json()) as LedgerSummary;
    void writeCache(data);
    return { data, offline: false };
  } catch {
    const cached = await readCache();
    if (cached) return { data: cached, offline: true };
    throw new Error("Ledger unavailable offline — open once while online to cache it.");
  }
}
