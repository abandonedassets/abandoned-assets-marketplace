INSERT INTO public.institutional_api_keys
  (label, key_prefix, key_hash, hmac_secret, sandbox, is_active, rate_limit_per_minute, onboarding_state, require_asymmetric)
VALUES
  ('UAT TENANT internal-platform-test-001',
   'uat_internal_001',
   'd4a4bdad29c0afdc5ea50e82f2c22acc7287b1fa5ea8b5ec278da882bab4cc7a',
   '84a8025992491a6580c24343b9cdca8a3387bacae8a14225b27129cb34650340',
   true, true, 240, 'PROVISIONED', false)
ON CONFLICT DO NOTHING;