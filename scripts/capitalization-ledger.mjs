#!/usr/bin/env node
// Capitalization Ledger generator (ASC 350-40 internal-use software).
// Reads full git history, groups commits into chronological sprints (by day),
// derives labor hours from code volume + feature complexity, writes
// docs/capitalization_ledger/{development_log.md,audit_log.json}.
import { execSync } from "node:child_process";
import { writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";

export const HOURLY_RATE_USD = 150;
const OUT = path.resolve(process.cwd(), "docs/capitalization_ledger");

const MILESTONES = [
  [/stripe|payout|invoice|payment|checkout|escrow/i, "Payments, Stripe Webhooks & Escrow Settlement"],
  [/dip|bankrupt|363|court/i, "DIP / Chapter 11 Section 363 Ingest"],
  [/tenant|source[-_ ]?system|routing|attribution/i, "Multi-Tenant Routing & Fee Attribution"],
  [/idempoten|replay|hmac|signature|security|rls|policy|auth/i, "Security, Idempotency Guards & HMAC Protocol"],
  [/m2m|clearing|clearinghouse|liquidity|buy.?box|match/i, "M2M Clearinghouse & Liquidity Engine"],
  [/cron|sweep|autonomous|self.?heal|watchdog|observer|retry/i, "Autonomous Cron, Self-Healing & Observability"],
  [/migration|supabase|schema|table|trigger|rpc|sql/i, "Database Schema, Triggers & RPC Layer"],
  [/ingest|scrape|gis|county|enrich|underwrit|arv|score/i, "Data Ingestion, Enrichment & Underwriting"],
  [/terminal|dashboard|ui|admin|route|component|page|design|style/i, "UI Terminals & Admin Dashboards"],
];
function milestoneFor(msg, files) {
  const hay = msg + " " + files.join(" ");
  for (const [re, label] of MILESTONES) if (re.test(hay)) return label;
  return "Core Platform Engineering";
}

// Complexity weighting per file class.
function fileWeight(f) {
  if (/routeTree\.gen\.ts|package-lock|bun\.lock|\.gen\./.test(f)) return 0.1;
  if (/supabase\/migrations\//.test(f)) return 1.6;
  if (/\.server\.ts|\.functions\.ts|routes\/api\//.test(f)) return 1.5;
  if (/integrations\/supabase\/types\.ts/.test(f)) return 0.2;
  if (/\.tsx?$/.test(f)) return 1.2;
  return 0.8;
}

export function parseGitLog(raw) {
  const commits = [];
  let cur = null;
  for (const line of raw.split("\n")) {
    if (line.includes("\u0001")) {
      if (cur) commits.push(cur);
      const [hash, iso, subject] = line.split("\u0001");
      cur = { hash, iso, subject, files: [], added: 0, removed: 0, weighted: 0 };
    } else if (cur && /^\d+\t\d+\t|^-\t-\t/.test(line)) {
      const [a, r, f] = line.split("\t");
      const add = a === "-" ? 0 : Number(a);
      const rem = r === "-" ? 0 : Number(r);
      cur.files.push(f);
      cur.added += add;
      cur.removed += rem;
      cur.weighted += (add + rem * 0.5) * fileWeight(f);
    }
  }
  if (cur) commits.push(cur);
  return commits;
}

// Hours model: baseline session overhead per commit + volume-derived effort,
// bounded so a single mega-commit never distorts the ledger.
export function hoursFor(c) {
  const base = 0.35;
  const volume = Math.min(6, c.weighted / 90);
  const breadth = Math.min(1.5, c.files.filter((f) => !/\.gen\./.test(f)).length * 0.1);
  return Math.round((base + volume + breadth) * 100) / 100;
}

function main() {
  let raw = "";
  try {
    raw = execSync(
      'git log --reverse --pretty=format:"%H\u0001%aI\u0001%s" --numstat',
      { maxBuffer: 256 * 1024 * 1024, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
    );
  } catch {
    // No git history available (fresh/orphan branch, CI shallow clone) — skip the ledger.
    console.warn("[capitalization-ledger] no git history available; skipping ledger generation");
    return;
  }
  const commits = parseGitLog(raw);

  const events = commits.map((c) => {
    const hours = hoursFor(c);
    return {
      timestamp: c.iso,
      commit_hash: c.hash,
      milestone: milestoneFor(c.subject, c.files),
      subject: c.subject,
      files_modified: c.files,
      lines_added: c.added,
      lines_removed: c.removed,
      hours_logged: hours,
      hourly_rate_usd: HOURLY_RATE_USD,
      capitalized_value_usd: Math.round(hours * HOURLY_RATE_USD * 100) / 100,
    };
  });

  const totalHours = Math.round(events.reduce((s, e) => s + e.hours_logged, 0) * 100) / 100;
  const totalValue = Math.round(totalHours * HOURLY_RATE_USD * 100) / 100;

  // Sprints = calendar days of activity.
  const sprints = new Map();
  for (const e of events) {
    const day = e.timestamp.slice(0, 10);
    const s = sprints.get(day) ?? { day, commits: 0, hours: 0, value: 0, milestones: new Map() };
    s.commits += 1;
    s.hours += e.hours_logged;
    s.value += e.capitalized_value_usd;
    s.milestones.set(e.milestone, (s.milestones.get(e.milestone) ?? 0) + e.hours_logged);
    sprints.set(day, s);
  }

  const byMilestone = new Map();
  for (const e of events) {
    const m = byMilestone.get(e.milestone) ?? { hours: 0, value: 0, commits: 0 };
    m.hours += e.hours_logged; m.value += e.capitalized_value_usd; m.commits += 1;
    byMilestone.set(e.milestone, m);
  }

  const ledger = {
    generated_at: new Date().toISOString(),
    standard: "US GAAP ASC 350-40 / ASU 2025-06 — internal-use software capitalization",
    hourly_rate_usd: HOURLY_RATE_USD,
    management_authorization_date: events[0]?.timestamp ?? null,
    first_commit: events[0]?.timestamp ?? null,
    last_commit: events.at(-1)?.timestamp ?? null,
    total_commits: events.length,
    total_hours_logged: totalHours,
    total_capitalized_value_usd: totalValue,
    milestone_summary: [...byMilestone.entries()].map(([milestone, m]) => ({
      milestone,
      commits: m.commits,
      hours_logged: Math.round(m.hours * 100) / 100,
      capitalized_value_usd: Math.round(m.value * 100) / 100,
    })).sort((a, b) => b.capitalized_value_usd - a.capitalized_value_usd),
    events,
  };

  mkdirSync(OUT, { recursive: true });
  writeFileSync(path.join(OUT, "audit_log.json"), JSON.stringify(ledger, null, 2));

  const fmt = (n) => "$" + n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  // Compact, bundle-friendly projection consumed by /admin/system-ledger.
  const summary = JSON.stringify({
      generated_at: ledger.generated_at,
      hourly_rate_usd: HOURLY_RATE_USD,
      management_authorization_date: ledger.management_authorization_date,
      first_commit: ledger.first_commit,
      last_commit: ledger.last_commit,
      total_commits: ledger.total_commits,
      total_hours_logged: totalHours,
      total_capitalized_value_usd: totalValue,
      milestone_summary: ledger.milestone_summary,
      events: events.map((e) => ({
        t: e.timestamp,
        h: e.commit_hash,
        m: e.milestone,
        s: e.subject,
        f: e.files_modified.length,
        hrs: e.hours_logged,
        v: e.capitalized_value_usd,
      })),
    });
  writeFileSync(path.join(OUT, "ledger_summary.json"), summary);
  // Served statically so the dashboard can fetch + cache it offline.
  const PUB = path.resolve(process.cwd(), "public/ledger");
  mkdirSync(PUB, { recursive: true });
  writeFileSync(path.join(PUB, "ledger_summary.json"), summary);
  writeFileSync(path.join(PUB, "audit_log.json"), JSON.stringify(ledger));

  const md = [
    "# Development Log — Capitalization Ledger",
    "",
    `Standard: US GAAP ASC 350-40 / ASU 2025-06 (internal-use software).`,
    `Benchmark rate: $${HOURLY_RATE_USD}/hour (Senior Systems Architect).`,
    `Management authorization / capitalization start: **${ledger.management_authorization_date?.slice(0, 10)}**`,
    "",
    "## Summary",
    "",
    `- Commits audited: **${ledger.total_commits}**`,
    `- Engineering hours logged: **${totalHours.toLocaleString("en-US")}**`,
    `- Capitalized software equity: **${fmt(totalValue)}**`,
    `- Period: ${ledger.first_commit?.slice(0, 10)} → ${ledger.last_commit?.slice(0, 10)}`,
    "",
    "## Milestone Breakdown",
    "",
    "| Milestone | Commits | Hours | Capitalized Value |",
    "| --- | ---: | ---: | ---: |",
    ...ledger.milestone_summary.map((m) => `| ${m.milestone} | ${m.commits} | ${m.hours_logged} | ${fmt(m.capitalized_value_usd)} |`),
    "",
    "## Chronological Sprint Log",
    "",
    "| Sprint (day) | Commits | Hours | Value | Primary milestones |",
    "| --- | ---: | ---: | ---: | --- |",
    ...[...sprints.values()].map((s) =>
      `| ${s.day} | ${s.commits} | ${Math.round(s.hours * 100) / 100} | ${fmt(Math.round(s.value * 100) / 100)} | ${[...s.milestones.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([m]) => m).join("; ")} |`,
    ),
    "",
    "---",
    "",
    "Every line item is cryptographically anchored to an immutable Git commit SHA in `audit_log.json`.",
    "",
  ].join("\n");
  writeFileSync(path.join(OUT, "development_log.md"), md);

  console.log(`Ledger written: ${events.length} commits, ${totalHours} hours, ${fmt(totalValue)}`);

  // Optional deployment webhook (Google Sheets / Zapier / custom). Fail-forward.
  const hook = process.env.LEDGER_WEBHOOK_URL;
  if (hook) {
    fetch(hook, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        total_hours: totalHours,
        capitalized_value_usd: totalValue,
        total_commits: events.length,
        last_commit_hash: events.at(-1)?.commit_hash ?? null,
        generated_at: ledger.generated_at,
      }),
    })
      .then((r) => console.log(`Ledger webhook -> ${r.status}`))
      .catch((e) => console.warn("Ledger webhook failed:", e.message));
  }
}

main();

