
CREATE OR REPLACE FUNCTION public.auto_bundle_orphaned_assets(
  _min_age_hours integer DEFAULT 24,
  _min_group_size integer DEFAULT 2,
  _max_bundles_per_run integer DEFAULT 20
)
RETURNS TABLE(bundle_id uuid, zip text, deal_count integer, total_base numeric, blended_yield numeric)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  _grp RECORD;
  _new_bundle_id uuid;
  _bundles_created integer := 0;
  _blended_yield numeric;
  _total_base numeric;
  _total_fee numeric;
BEGIN
  FOR _grp IN
    SELECT zip, ARRAY_AGG(id ORDER BY created_at ASC) AS ids, COUNT(*) AS n
    FROM public.closing_pipeline_items
    WHERE matched_buyer_id IS NULL
      AND bundle_id IS NULL
      AND COALESCE(is_held, false) = false
      AND COALESCE(is_stale, false) = false
      AND COALESCE(manual_review, false) = false
      AND COALESCE(requires_legal_review, false) = false
      AND status::text NOT IN (
        'Funds-Cleared','Closed','Dead','CRITICAL_STALL',
        'Locked-Escrow-Pending','System-Hold','Queued-For-Tomorrow'
      )
      AND zip IS NOT NULL
      AND created_at < now() - make_interval(hours => _min_age_hours)
    GROUP BY zip
    HAVING COUNT(*) >= _min_group_size
    ORDER BY COUNT(*) DESC
    LIMIT _max_bundles_per_run
  LOOP
    SELECT
      COALESCE(SUM(base_contract_price), 0),
      COALESCE(SUM(optimized_acquisition_premium), 0)
    INTO _total_base, _total_fee
    FROM public.closing_pipeline_items
    WHERE id = ANY(_grp.ids);

    _blended_yield := CASE WHEN _total_base > 0
      THEN ROUND((_total_fee / _total_base) * 10000) / 10000.0
      ELSE 0 END;

    INSERT INTO public.bundles(
      name, region_tag, status, institutional_tape,
      total_base, total_fee, total_arv, deal_count,
      criteria
    ) VALUES (
      'Synthetic Portfolio — ZIP ' || _grp.zip || ' — ' || _grp.n || ' assets',
      _grp.zip, 'OPEN', true,
      0, 0, 0, 0,
      jsonb_build_object(
        'synthetic', true,
        'zip', _grp.zip,
        'asset_count', _grp.n,
        'blended_yield', _blended_yield,
        'total_base_at_creation', _total_base,
        'total_fee_at_creation', _total_fee,
        'auto_generated_at', now(),
        'tier', 'INSTITUTIONAL_BULK'
      )
    ) RETURNING id INTO _new_bundle_id;

    -- Attach assets; sync_bundle_on_deal_change trigger recalcs totals
    UPDATE public.closing_pipeline_items
       SET bundle_id = _new_bundle_id, updated_at = now()
     WHERE id = ANY(_grp.ids)
       AND bundle_id IS NULL
       AND matched_buyer_id IS NULL;

    INSERT INTO public.system_alerts(severity, kind, message, metadata)
    VALUES ('low','synthetic_bundle_created',
      'Synthetic Portfolio assembled for ZIP ' || _grp.zip || ' — ' || _grp.n || ' orphaned assets repackaged',
      jsonb_build_object(
        'bundle_id', _new_bundle_id,
        'zip', _grp.zip,
        'deal_count', _grp.n,
        'total_base', _total_base,
        'blended_yield', _blended_yield
      ));

    _bundles_created := _bundles_created + 1;
    bundle_id := _new_bundle_id;
    zip := _grp.zip;
    deal_count := _grp.n::int;
    total_base := _total_base;
    blended_yield := _blended_yield;
    RETURN NEXT;
  END LOOP;
END;
$$;
