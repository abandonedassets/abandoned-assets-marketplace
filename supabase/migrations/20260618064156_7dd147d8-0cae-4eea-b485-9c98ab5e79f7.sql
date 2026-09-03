
-- 1. AUDIT LEDGER
CREATE TABLE IF NOT EXISTS public.system_audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  table_name TEXT NOT NULL,
  row_id UUID,
  operation TEXT NOT NULL,
  old_data JSONB,
  new_data JSONB,
  changed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  changed_by UUID
);

GRANT SELECT ON public.system_audit_log TO authenticated;
GRANT ALL ON public.system_audit_log TO service_role;

ALTER TABLE public.system_audit_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can view audit log"
  ON public.system_audit_log FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE INDEX IF NOT EXISTS idx_system_audit_log_row ON public.system_audit_log(row_id, changed_at DESC);
CREATE INDEX IF NOT EXISTS idx_system_audit_log_table ON public.system_audit_log(table_name, changed_at DESC);

-- 2. IMMUTABLE FEE ENGINE
CREATE OR REPLACE FUNCTION public.calculate_pipeline_fee(p_total_amount NUMERIC)
RETURNS NUMERIC
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
BEGIN
  IF p_total_amount IS NULL OR p_total_amount <= 0 THEN RETURN 250; END IF;
  RETURN GREATEST(250, ROUND(p_total_amount * 0.05, 0));
END;
$$;

-- 3. OPTIMISTIC LOCKING — version column
ALTER TABLE public.closing_pipeline_items
  ADD COLUMN IF NOT EXISTS row_version BIGINT NOT NULL DEFAULT 1;

CREATE OR REPLACE FUNCTION public.cpi_bump_row_version()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  NEW.row_version := COALESCE(OLD.row_version, 0) + 1;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_cpi_bump_row_version ON public.closing_pipeline_items;
CREATE TRIGGER trg_cpi_bump_row_version
  BEFORE UPDATE ON public.closing_pipeline_items
  FOR EACH ROW EXECUTE FUNCTION public.cpi_bump_row_version();

-- 4. IMMUTABLE LOCKED FEES — reject fee edits on terminal/locked rows
CREATE OR REPLACE FUNCTION public.cpi_enforce_locked_fee_immutability()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _locked_statuses TEXT[] := ARRAY['Locked-Escrow-Pending','Funds-Cleared','Closed'];
BEGIN
  IF current_setting('role', true) = 'service_role'
     OR session_user IN ('service_role','postgres')
     OR COALESCE(OLD.sovereign_override, false) = true THEN
    RETURN NEW;
  END IF;

  IF OLD.status::text = ANY(_locked_statuses) THEN
    IF NEW.optimized_acquisition_premium IS DISTINCT FROM OLD.optimized_acquisition_premium
       OR NEW.cleared_amount IS DISTINCT FROM OLD.cleared_amount
       OR NEW.base_contract_price IS DISTINCT FROM OLD.base_contract_price THEN
      RAISE EXCEPTION 'LOCKED_FEE_IMMUTABLE: cannot modify fees on % rows', OLD.status
        USING ERRCODE = 'P0001';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_cpi_enforce_locked_fee ON public.closing_pipeline_items;
CREATE TRIGGER trg_cpi_enforce_locked_fee
  BEFORE UPDATE ON public.closing_pipeline_items
  FOR EACH ROW EXECUTE FUNCTION public.cpi_enforce_locked_fee_immutability();

-- 5. AUDIT TRIGGER on closing_pipeline_items
CREATE OR REPLACE FUNCTION public.cpi_write_audit_log()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  BEGIN
    IF TG_OP = 'DELETE' THEN
      INSERT INTO public.system_audit_log(table_name, row_id, operation, old_data, new_data, changed_by)
      VALUES (TG_TABLE_NAME, OLD.id, TG_OP, to_jsonb(OLD), NULL, auth.uid());
      RETURN OLD;
    ELSIF TG_OP = 'UPDATE' THEN
      IF to_jsonb(OLD) IS DISTINCT FROM to_jsonb(NEW) THEN
        INSERT INTO public.system_audit_log(table_name, row_id, operation, old_data, new_data, changed_by)
        VALUES (TG_TABLE_NAME, NEW.id, TG_OP, to_jsonb(OLD), to_jsonb(NEW), auth.uid());
      END IF;
    ELSIF TG_OP = 'INSERT' THEN
      INSERT INTO public.system_audit_log(table_name, row_id, operation, old_data, new_data, changed_by)
      VALUES (TG_TABLE_NAME, NEW.id, TG_OP, NULL, to_jsonb(NEW), auth.uid());
    END IF;
  EXCEPTION WHEN OTHERS THEN
    NULL; -- fail-forward: never block pipeline on audit write
  END;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_cpi_audit_log ON public.closing_pipeline_items;
CREATE TRIGGER trg_cpi_audit_log
  AFTER INSERT OR UPDATE OR DELETE ON public.closing_pipeline_items
  FOR EACH ROW EXECUTE FUNCTION public.cpi_write_audit_log();
