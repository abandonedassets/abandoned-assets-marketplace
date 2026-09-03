ALTER TABLE public.closing_pipeline_items DISABLE TRIGGER trg_cpi_adversarial_audit;

UPDATE public.closing_pipeline_items
SET status = 'New',
    cleared_at = NULL,
    cleared_amount = 0
WHERE cleared_at IS NOT NULL
  AND stripe_session_id IS NULL;

ALTER TABLE public.closing_pipeline_items ENABLE TRIGGER trg_cpi_adversarial_audit;

SELECT public.refresh_system_metrics();