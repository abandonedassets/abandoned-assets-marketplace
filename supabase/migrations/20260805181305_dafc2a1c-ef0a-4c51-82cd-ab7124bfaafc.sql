REVOKE ALL ON FUNCTION public.detect_assemblage_groups() FROM authenticated;
REVOKE ALL ON FUNCTION public.commercial_assemblage_radar() FROM authenticated;
REVOKE ALL ON FUNCTION public.mission_control_pulse() FROM authenticated;
REVOKE ALL ON FUNCTION public.clear_funds_idempotent(uuid, numeric, text) FROM authenticated;
REVOKE ALL ON FUNCTION public.cleared_today_usd() FROM authenticated;
REVOKE ALL ON FUNCTION public.cvi_metrics() FROM authenticated;
REVOKE ALL ON FUNCTION public.assemblage_radar_snapshot() FROM authenticated;