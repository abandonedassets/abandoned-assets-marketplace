select cron.unschedule('buyer-syndication-sweep') where exists (select 1 from cron.job where jobname='buyer-syndication-sweep');
select cron.unschedule('offer-ratchet-sweep') where exists (select 1 from cron.job where jobname='offer-ratchet-sweep');

select cron.schedule('buyer-syndication-sweep', '*/10 * * * *', $$
  select net.http_post(
    url := 'https://asset-weaver-30.lovable.app/api/public/hooks/dispatch',
    headers := '{"Content-Type": "application/json"}'::jsonb,
    body := '{"limit": 25}'::jsonb
  ) as request_id;
$$);

select cron.schedule('offer-ratchet-sweep', '13 * * * *', $$
  select net.http_post(
    url := 'https://asset-weaver-30.lovable.app/api/public/hooks/offer-ratchet',
    headers := '{"Content-Type": "application/json"}'::jsonb,
    body := '{}'::jsonb
  ) as request_id;
$$);