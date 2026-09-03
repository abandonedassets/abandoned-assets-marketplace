with calc as (
  select id,
    case
      when coalesce(asset_type,'') ilike '%timber%' or coalesce(timber_density_score,0) > 0 then 'TIMBERLAND'
      when coalesce(asset_type,'') ilike '%lot%' or coalesce(asset_type,'') ilike '%land%' or coalesce(asset_type,'') ilike '%vacant%' or coalesce(sqft,0) = 0 then 'LOT_LAND'
      else 'IMPROVED'
    end as cls,
    coalesce(base_contract_price,0) as p,
    coalesce(nullif(calculated_arv,0), round(coalesce(base_contract_price,0) * 1.25)) as arv,
    estimated_repairs
  from public.closing_pipeline_items
  where status not in ('Closed','Dead','Funds-Cleared')
), m as (
  select id, cls, p, arv,
    case when cls = 'IMPROVED' then coalesce(estimated_repairs,0) else 0 end as repairs,
    round(case
      when cls = 'TIMBERLAND' and p < 100000 then greatest(5000, p*0.10)
      when cls = 'TIMBERLAND' then greatest(10000, p*0.075)
      when cls = 'LOT_LAND' and p < 50000 then greatest(2500, p*0.10)
      when cls = 'LOT_LAND' and p < 150000 then greatest(5000, p*0.075)
      when p >= 1000000 then greatest(10000, p*0.03)
      when p >= 500000 then greatest(10000, p*0.035)
      when p >= 250000 then greatest(10000, p*0.04)
      else 10000
    end) as target_fee
  from calc
)
update public.closing_pipeline_items c
set optimized_acquisition_premium = m.target_fee,
    is_fee_positive = (m.arv - m.repairs - m.p) >= m.target_fee,
    absolute_floor_price = nullif(greatest(round(m.arv*0.70 - m.repairs - m.target_fee), 0), 0)
from m
where c.id = m.id
  and ((m.arv - m.repairs - m.p) >= m.target_fee)
  and coalesce(c.optimized_acquisition_premium,0) <> m.target_fee;