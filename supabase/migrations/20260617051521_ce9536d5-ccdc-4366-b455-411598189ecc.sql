
UPDATE public.closing_pipeline_items
SET optimized_acquisition_premium = LEAST(
  500000,
  GREATEST(
    5000,
    ROUND(base_contract_price * CASE
      WHEN base_contract_price < 100000 THEN 0.05
      WHEN base_contract_price < 500000 THEN 0.04
      WHEN base_contract_price < 2000000 THEN 0.03
      ELSE 0.025
    END)::numeric
  )
),
updated_at = now()
WHERE base_contract_price IS NOT NULL
  AND status::text IN ('New','Buyer-Matched','Buyer-Signed')
  AND is_held = false;
