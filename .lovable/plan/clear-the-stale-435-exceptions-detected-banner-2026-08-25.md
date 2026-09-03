# Clear the stale "435 exceptions detected" banner

## What the number actually is

The banner is not a hardcoded 435 and it is not the exceptions log table. Verified:

- The banner reads `manual_review_count + stale_count` from the deals feed.
- The real exception log (`exception_queue`) has **0 unresolved rows** (473 total, all resolved). Nothing to purge there.
- `manual_review = true` matches exactly **435 rows**, and every one of them has status `Rejected` — dead, terminal deals. No live row is flagged.

So the banner is counting rejected/dead history as if it were an active exception.

## Fix

1. In the deals feed query, scope the manual-review count to live deals only — exclude terminal statuses (`Rejected`, `Dead`, `Auto_Archived_Bad_Data`, `Closed`). This alone drops the banner to 0 and it stays accurate going forward, so it will re-arm properly if a live deal ever needs review.
2. Data cleanup migration: clear the `manual_review` flag on the 435 rows that are already `Rejected`, so the stale flag doesn't resurface in any other view or query.
3. No layout, component, or styling changes. The existing amber banner / green "Zero Exceptions" bar behaves exactly as today — it just gets a correct input.

Note on the requested "reset on autopilot": tying the counter to the Autopilot toggle would mask genuine exceptions whenever autopilot is on. Scoping to live deals gives the same clean state without blinding the diagnostic.

## Technical detail

- `src/lib/deals.functions.ts` (~line 501): add a `.not("status", "in", "(Rejected,Dead,Auto_Archived_Bad_Data,Closed)")` filter to the `manual_review_count` head count.
- One SQL migration: `UPDATE closing_pipeline_items SET manual_review = false WHERE manual_review AND status IN ('Rejected','Dead','Auto_Archived_Bad_Data','Closed');`
- `src/routes/index.tsx` untouched.
