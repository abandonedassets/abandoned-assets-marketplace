ALTER TABLE public.institutional_api_keys
  ADD COLUMN IF NOT EXISTS onboarding_state text NOT NULL DEFAULT 'INVITED',
  ADD COLUMN IF NOT EXISTS ecdsa_public_key text,
  ADD COLUMN IF NOT EXISTS require_asymmetric boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS uat_verified_at timestamptz,
  ADD COLUMN IF NOT EXISTS production_enabled_at timestamptz,
  ADD COLUMN IF NOT EXISTS first_intent_at timestamptz;

DO $$ BEGIN
  ALTER TABLE public.institutional_api_keys
    ADD CONSTRAINT institutional_api_keys_onboarding_state_chk
    CHECK (onboarding_state IN ('INVITED','PROVISIONED','UAT_VERIFIED','PRODUCTION_ENABLED','ACTIVE'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

UPDATE public.institutional_api_keys SET onboarding_state = 'PROVISIONED'
  WHERE onboarding_state = 'INVITED' AND key_prefix IS NOT NULL;
UPDATE public.institutional_api_keys SET onboarding_state = 'ACTIVE', first_intent_at = COALESCE(first_intent_at, last_used_at)
  WHERE last_used_at IS NOT NULL;