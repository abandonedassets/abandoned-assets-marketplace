CREATE TABLE IF NOT EXISTS public.evolution_mutations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cycle_id uuid NOT NULL DEFAULT gen_random_uuid(),
  defect_code text NOT NULL,
  hypothesis text,
  knob text NOT NULL,
  prior_value numeric,
  new_value numeric,
  status text NOT NULL DEFAULT 'DEPLOYED',
  baseline_metrics jsonb NOT NULL DEFAULT '{}'::jsonb,
  observed_metrics jsonb NOT NULL DEFAULT '{}'::jsonb,
  fitness_delta numeric,
  sandbox_passed boolean NOT NULL DEFAULT false,
  verified_at timestamptz,
  rolled_back_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS evo_status_idx ON public.evolution_mutations(status, created_at DESC);
GRANT SELECT ON public.evolution_mutations TO authenticated;
GRANT ALL ON public.evolution_mutations TO service_role;
ALTER TABLE public.evolution_mutations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "evo admin read" ON public.evolution_mutations FOR SELECT TO authenticated USING (public.has_role(auth.uid(),'admin'));

CREATE TABLE IF NOT EXISTS public.evolution_metrics_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  captured_at timestamptz NOT NULL DEFAULT now(),
  metrics jsonb NOT NULL DEFAULT '{}'::jsonb,
  fitness numeric NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS evo_snap_idx ON public.evolution_metrics_snapshots(captured_at DESC);
GRANT SELECT ON public.evolution_metrics_snapshots TO authenticated;
GRANT ALL ON public.evolution_metrics_snapshots TO service_role;
ALTER TABLE public.evolution_metrics_snapshots ENABLE ROW LEVEL SECURITY;
CREATE POLICY "evo snap admin read" ON public.evolution_metrics_snapshots FOR SELECT TO authenticated USING (public.has_role(auth.uid(),'admin'));