ALTER TABLE public.buyer_buy_boxes
ADD COLUMN IF NOT EXISTS contact_email VARCHAR(255) NULL,
ADD COLUMN IF NOT EXISTS webhook_url VARCHAR(255) NULL;

UPDATE public.buyer_buy_boxes
SET contact_email = 'info.abandonedassets@gmail.com'
WHERE label ILIKE '%TEST 1031%';