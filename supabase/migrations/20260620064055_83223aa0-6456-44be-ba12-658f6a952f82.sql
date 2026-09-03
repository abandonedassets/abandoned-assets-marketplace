
-- Structural anchor: closing_pipeline_items.idempotency_key -> ingest_idempotency_keys.hash

-- 1. Ensure ingest_idempotency_keys.hash is uniquely addressable (FK target requirement)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'ingest_idempotency_keys_hash_key'
  ) THEN
    ALTER TABLE public.ingest_idempotency_keys
      ADD CONSTRAINT ingest_idempotency_keys_hash_key UNIQUE (hash);
  END IF;
END $$;

-- 2. Prevent two closing rows from claiming the same ingest hash
CREATE UNIQUE INDEX IF NOT EXISTS closing_pipeline_items_idem_uidx
  ON public.closing_pipeline_items (idempotency_key)
  WHERE idempotency_key IS NOT NULL;

-- 3. Enforce referential integrity (nullable allowed for legacy rows)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'closing_pipeline_items_idempotency_fk'
  ) THEN
    ALTER TABLE public.closing_pipeline_items
      ADD CONSTRAINT closing_pipeline_items_idempotency_fk
      FOREIGN KEY (idempotency_key)
      REFERENCES public.ingest_idempotency_keys(hash)
      ON DELETE RESTRICT
      NOT VALID;
    ALTER TABLE public.closing_pipeline_items
      VALIDATE CONSTRAINT closing_pipeline_items_idempotency_fk;
  END IF;
END $$;
