CREATE OR REPLACE FUNCTION public.m2m_claim_dispatch(_id uuid, _box_id uuid, _window_seconds integer DEFAULT 900)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
BEGIN
  UPDATE closing_pipeline_items
     SET m2m_box_id = _box_id,
         m2m_expires_at = now() + make_interval(secs => GREATEST(_window_seconds, 5))
   WHERE id = _id
     AND cleared_at IS NULL
     AND (m2m_expires_at IS NULL OR m2m_expires_at < now());
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'locked_or_cleared');
  END IF;
  RETURN jsonb_build_object('ok', true, 'expires_at', now() + make_interval(secs => GREATEST(_window_seconds, 5)));
END;
$fn$;