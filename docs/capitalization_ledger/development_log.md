# Development Log — Capitalization Ledger

Standard: US GAAP ASC 350-40 / ASU 2025-06 (internal-use software).
Benchmark rate: $150/hour (Senior Systems Architect).
Management authorization / capitalization start: **2025-01-01**

## Summary

- Commits audited: **2958**
- Engineering hours logged: **3,216.08**
- Capitalized software equity: **$482,412.00**
- Period: 2025-01-01 → 2026-09-03

## Milestone Breakdown

| Milestone | Commits | Hours | Capitalized Value |
| --- | ---: | ---: | ---: |
| Core Platform Engineering | 988 | 1109.47 | $166,420.50 |
| UI Terminals & Admin Dashboards | 875 | 728.98 | $109,347.00 |
| Database Schema, Triggers & RPC Layer | 269 | 390.98 | $58,647.00 |
| Security, Idempotency Guards & HMAC Protocol | 213 | 286.09 | $42,913.50 |
| Payments, Stripe Webhooks & Escrow Settlement | 202 | 243.73 | $36,559.50 |
| Autonomous Cron, Self-Healing & Observability | 143 | 161.24 | $24,186.00 |
| M2M Clearinghouse & Liquidity Engine | 151 | 153.58 | $23,037.00 |
| Data Ingestion, Enrichment & Underwriting | 97 | 116.23 | $17,434.50 |
| Multi-Tenant Routing & Fee Attribution | 15 | 18.26 | $2,739.00 |
| DIP / Chapter 11 Section 363 Ingest | 5 | 7.52 | $1,128.00 |

## Chronological Sprint Log

| Sprint (day) | Commits | Hours | Value | Primary milestones |
| --- | ---: | ---: | ---: | --- |
| 2025-01-01 | 1 | 7.85 | $1,177.50 | Database Schema, Triggers & RPC Layer |
| 2026-06-12 | 37 | 52.11 | $7,816.50 | UI Terminals & Admin Dashboards; Security, Idempotency Guards & HMAC Protocol; Database Schema, Triggers & RPC Layer |
| 2026-06-13 | 54 | 62.93 | $9,439.50 | UI Terminals & Admin Dashboards; Database Schema, Triggers & RPC Layer; Security, Idempotency Guards & HMAC Protocol |
| 2026-06-14 | 41 | 32.59 | $4,888.50 | Security, Idempotency Guards & HMAC Protocol; Data Ingestion, Enrichment & Underwriting; Core Platform Engineering |
| 2026-06-15 | 32 | 25.2 | $3,780.00 | Data Ingestion, Enrichment & Underwriting; Security, Idempotency Guards & HMAC Protocol; Payments, Stripe Webhooks & Escrow Settlement |
| 2026-06-16 | 58 | 62.01 | $9,301.50 | Autonomous Cron, Self-Healing & Observability; UI Terminals & Admin Dashboards; Database Schema, Triggers & RPC Layer |
| 2026-06-17 | 121 | 110.44 | $16,566.00 | Database Schema, Triggers & RPC Layer; UI Terminals & Admin Dashboards; Security, Idempotency Guards & HMAC Protocol |
| 2026-06-18 | 55 | 57.52 | $8,628.00 | Database Schema, Triggers & RPC Layer; UI Terminals & Admin Dashboards; Core Platform Engineering |
| 2026-06-19 | 50 | 42.15 | $6,322.50 | Database Schema, Triggers & RPC Layer; UI Terminals & Admin Dashboards; Core Platform Engineering |
| 2026-06-20 | 40 | 32.05 | $4,807.50 | Payments, Stripe Webhooks & Escrow Settlement; Database Schema, Triggers & RPC Layer; Data Ingestion, Enrichment & Underwriting |
| 2026-06-23 | 4 | 1.63 | $244.50 | Core Platform Engineering; UI Terminals & Admin Dashboards |
| 2026-06-24 | 3 | 1.6 | $240.00 | Database Schema, Triggers & RPC Layer; UI Terminals & Admin Dashboards; Data Ingestion, Enrichment & Underwriting |
| 2026-06-28 | 41 | 42.22 | $6,333.00 | Payments, Stripe Webhooks & Escrow Settlement; Security, Idempotency Guards & HMAC Protocol; Database Schema, Triggers & RPC Layer |
| 2026-08-03 | 76 | 82.93 | $12,439.50 | Security, Idempotency Guards & HMAC Protocol; UI Terminals & Admin Dashboards; Core Platform Engineering |
| 2026-08-04 | 63 | 74.72 | $11,208.00 | UI Terminals & Admin Dashboards; Core Platform Engineering; Database Schema, Triggers & RPC Layer |
| 2026-08-05 | 66 | 74.23 | $11,134.50 | UI Terminals & Admin Dashboards; Core Platform Engineering; Database Schema, Triggers & RPC Layer |
| 2026-08-06 | 24 | 20.09 | $3,013.50 | M2M Clearinghouse & Liquidity Engine; Autonomous Cron, Self-Healing & Observability; UI Terminals & Admin Dashboards |
| 2026-08-07 | 39 | 23.47 | $3,520.50 | Autonomous Cron, Self-Healing & Observability; UI Terminals & Admin Dashboards; Database Schema, Triggers & RPC Layer |
| 2026-08-08 | 153 | 145.53 | $21,829.50 | UI Terminals & Admin Dashboards; Core Platform Engineering; Database Schema, Triggers & RPC Layer |
| 2026-08-09 | 38 | 36.26 | $5,439.00 | UI Terminals & Admin Dashboards; Payments, Stripe Webhooks & Escrow Settlement; Core Platform Engineering |
| 2026-08-10 | 242 | 229.13 | $34,369.50 | UI Terminals & Admin Dashboards; Core Platform Engineering; M2M Clearinghouse & Liquidity Engine |
| 2026-08-11 | 119 | 130.96 | $19,644.00 | UI Terminals & Admin Dashboards; Security, Idempotency Guards & HMAC Protocol; Core Platform Engineering |
| 2026-08-12 | 19 | 15.08 | $2,262.00 | Core Platform Engineering; UI Terminals & Admin Dashboards; Database Schema, Triggers & RPC Layer |
| 2026-08-13 | 12 | 12.41 | $1,861.50 | Core Platform Engineering; UI Terminals & Admin Dashboards |
| 2026-08-14 | 16 | 17.39 | $2,608.50 | Core Platform Engineering; UI Terminals & Admin Dashboards; Security, Idempotency Guards & HMAC Protocol |
| 2026-08-15 | 63 | 80.84 | $12,126.00 | Core Platform Engineering; Payments, Stripe Webhooks & Escrow Settlement; UI Terminals & Admin Dashboards |
| 2026-08-16 | 27 | 38.87 | $5,830.50 | Core Platform Engineering; UI Terminals & Admin Dashboards; Security, Idempotency Guards & HMAC Protocol |
| 2026-08-17 | 78 | 90.71 | $13,606.50 | Core Platform Engineering; Database Schema, Triggers & RPC Layer; UI Terminals & Admin Dashboards |
| 2026-08-18 | 84 | 117.98 | $17,697.00 | Core Platform Engineering; UI Terminals & Admin Dashboards; Database Schema, Triggers & RPC Layer |
| 2026-08-19 | 53 | 60.33 | $9,049.50 | Core Platform Engineering; UI Terminals & Admin Dashboards; Security, Idempotency Guards & HMAC Protocol |
| 2026-08-20 | 36 | 44.39 | $6,658.50 | Database Schema, Triggers & RPC Layer; Core Platform Engineering; UI Terminals & Admin Dashboards |
| 2026-08-21 | 75 | 96.93 | $14,539.50 | Core Platform Engineering; UI Terminals & Admin Dashboards; Security, Idempotency Guards & HMAC Protocol |
| 2026-08-22 | 172 | 233.5 | $35,025.00 | Core Platform Engineering; UI Terminals & Admin Dashboards; M2M Clearinghouse & Liquidity Engine |
| 2026-08-23 | 249 | 292.83 | $43,924.50 | Core Platform Engineering; UI Terminals & Admin Dashboards; Autonomous Cron, Self-Healing & Observability |
| 2026-08-24 | 33 | 33.7 | $5,055.00 | Core Platform Engineering; Autonomous Cron, Self-Healing & Observability; UI Terminals & Admin Dashboards |
| 2026-08-25 | 113 | 123.46 | $18,519.00 | Core Platform Engineering; Payments, Stripe Webhooks & Escrow Settlement; UI Terminals & Admin Dashboards |
| 2026-08-26 | 38 | 41.3 | $6,195.00 | Core Platform Engineering; Payments, Stripe Webhooks & Escrow Settlement; Security, Idempotency Guards & HMAC Protocol |
| 2026-08-27 | 88 | 102.96 | $15,444.00 | Core Platform Engineering; Payments, Stripe Webhooks & Escrow Settlement; Database Schema, Triggers & RPC Layer |
| 2026-08-28 | 98 | 104.28 | $15,642.00 | Core Platform Engineering; M2M Clearinghouse & Liquidity Engine; Database Schema, Triggers & RPC Layer |
| 2026-08-29 | 42 | 35.31 | $5,296.50 | Core Platform Engineering; Database Schema, Triggers & RPC Layer; M2M Clearinghouse & Liquidity Engine |
| 2026-08-30 | 81 | 88.35 | $13,252.50 | Core Platform Engineering; UI Terminals & Admin Dashboards; Database Schema, Triggers & RPC Layer |
| 2026-08-31 | 90 | 109.78 | $16,467.00 | Core Platform Engineering; M2M Clearinghouse & Liquidity Engine; UI Terminals & Admin Dashboards |
| 2026-09-01 | 13 | 14.64 | $2,196.00 | Core Platform Engineering; Payments, Stripe Webhooks & Escrow Settlement; Database Schema, Triggers & RPC Layer |
| 2026-09-02 | 103 | 99.79 | $14,968.50 | Core Platform Engineering; Data Ingestion, Enrichment & Underwriting; UI Terminals & Admin Dashboards |
| 2026-09-03 | 18 | 13.63 | $2,044.50 | Core Platform Engineering; M2M Clearinghouse & Liquidity Engine |

---

Every line item is cryptographically anchored to an immutable Git commit SHA in `audit_log.json`.
