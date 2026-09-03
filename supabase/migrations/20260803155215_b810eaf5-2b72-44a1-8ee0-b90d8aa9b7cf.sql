ALTER TYPE public.app_pipeline_status ADD VALUE IF NOT EXISTS 'Webhook_Dispatched';
ALTER TYPE public.app_pipeline_status ADD VALUE IF NOT EXISTS 'Shadow_Inventory';
ALTER TABLE public.closing_pipeline_items ADD COLUMN IF NOT EXISTS notification_queued boolean NOT NULL DEFAULT false;