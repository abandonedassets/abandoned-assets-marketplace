-- ============================================================
-- GHOST-IN-THE-MACHINE PROTOCOL
-- Pillar 1: Ghost Liquidity (algorithmic price elasticity)
-- Pillar 2: Self-Healing Data Pipeline (already-active exception
--          queue + scheduled data-refresh sweep)
-- Pillar 3: Protocol-Level Settlement Drip (re-affirm cron alignment)
-- ============================================================

-- ---- system_config defaults for the protocol ----
INSERT INTO public.system_config(key, value) VALUES
  ('ghost_liquidity_decay_pct', '0.017'::jsonb),
  ('ghost_liquidity_stagnant_hours', '24'::jsonb),
  ('ghost_liquidity_floor_pct', '0.70'::jsonb)
ON CONFLICT (key) DO NOTHING;

-- ---- Pillar 1: algorithmic_price_adjustment ----
CREATE OR REPLACE FUNCTION public.algorithmic_price_adjustment()
RETURNS TABLE(deal_id uuid, old_price numeric, new_price numeric, action text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _r RECORD;
  _decay numeric;
  _stagnant_hours integer;
  _floor_pct numeric;
  _floor numeric;
  _new_price numeric;
BEGIN
  SELECT COALESCE((value)::text::numeric, 0.017) INTO _decay
  FROM public.system_config WHERE key = 'ghost_liquidity_decay_pct';
  IF _decay IS NULL OR _decay <= 0 THEN _decay := 0.017; END IF;

  SELECT COALESCE((value)::text::integer, 24) INTO _stagnant_hours
  FROM public.system_config WHERE key = 'ghost_liquidity_stagnant_hours';
  IF _stagnant_hours IS NULL OR _stagnant_hours < 1 THEN _stagnant_hours := 24; END IF;

  SELECT COALESCE((value)::text::numeric, 0.70) INTO _floor_pct
  FROM public.system_config WHERE key = 'ghost_liquidity_floor_pct';
  IF _floor_pct IS NULL OR _floor_pct <= 0 THEN _floor_pct := 0.70; END IF;

  FOR _r IN
    SELECT id, base_contract_price, absolute_floor_price, zip, updated_at
    FROM public.closing_pipeline_items
    WHERE matched_buyer_id IS NULL
      AND COALESCE(is_held,false) = false
      AND COALESCE(manual_review,false) = false
      AND COALESCE(requires_legal_review,false) = false
      AND status::text NOT IN (
        'Funds-Cleared','Closed','Dead','CRITICAL_STALL',
        'Locked-Escrow-Pending','System-Hold','Queued-For-Tomorrow'
      )
      AND base_contract_price IS NOT NULL
      AND base_contract_price > 0
      AND updated_at < now() - make_interval(hours => _stagnant_hours)
    ORDER BY updated_at ASC
    LIMIT 200
    FOR UPDATE SKIP LOCKED
  LOOP
    BEGIN
      _floor := COALESCE(_r.absolute_floor_price, ROUND(_r.base_contract_price * _floor_pct, 2));
      _new_price := ROUND(_r.base_contract_price * (1 - _decay), 2);

      IF _new_price <= _floor THEN
        -- At/under floor → reverse-strike trigger fires; mark and skip further decay
        UPDATE public.closing_pipeline_items
           SET base_contract_price = _floor,
               escrow_status = COALESCE(escrow_status,'ghost_floor_reached'),
               updated_at = now()
         WHERE id = _r.id;
        deal_id := _r.id; old_price := _r.base_contract_price; new_price := _floor; action := 'floor_reached';
        RETURN NEXT;
        CONTINUE;
      END IF;

      -- Apply decay; match_orange_squares trigger will re-evaluate buy boxes automatically
      UPDATE public.closing_pipeline_items
         SET base_contract_price = _new_price,
             updated_at = now()
       WHERE id = _r.id;

      INSERT INTO public.system_alerts(severity, kind, message, deal_id, metadata)
      VALUES ('low','ghost_liquidity_adjustment',
        'Price decayed ' || (_decay*100)::text || '% to find clearing buyer',
        _r.id,
        jsonb_build_object('zip',_r.zip,'old',_r.base_contract_price,'new',_new_price,'floor',_floor));

      deal_id := _r.id; old_price := _r.base_contract_price; new_price := _new_price; action := 'decayed';
      RETURN NEXT;
    EXCEPTION WHEN OTHERS THEN
      INSERT INTO public.system_alerts(severity, kind, message, deal_id, metadata)
      VALUES ('low','ghost_liquidity_error', SQLERRM, _r.id,
        jsonb_build_object('sqlstate',SQLSTATE));
    END;
  END LOOP;
END;
$$;

GRANT EXECUTE ON FUNCTION public.algorithmic_price_adjustment() TO service_role;

-- ---- Cron: every 6 hours at :17 ----
DO $$ BEGIN
  PERFORM cron.unschedule('ghost-liquidity-decay');
EXCEPTION WHEN OTHERS THEN NULL; END $$;

SELECT cron.schedule(
  'ghost-liquidity-decay',
  '17 */6 * * *',
  $$ SELECT public.algorithmic_price_adjustment(); $$
);

-- ---- Pillar 2: Data-Refresh Sweep (re-uses sweep_exception_queue) ----
DO $$ BEGIN
  PERFORM cron.unschedule('data-refresh-sweep');
EXCEPTION WHEN OTHERS THEN NULL; END $$;

SELECT cron.schedule(
  'data-refresh-sweep',
  '23 */4 * * *',
  $$ SELECT public.sweep_exception_queue(); $$
);
