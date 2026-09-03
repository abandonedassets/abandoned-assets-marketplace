
-- Roles infrastructure
CREATE TYPE public.app_role AS ENUM ('admin', 'moderator', 'user');

CREATE TABLE public.user_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role public.app_role NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, role)
);

GRANT SELECT ON public.user_roles TO authenticated;
GRANT ALL ON public.user_roles TO service_role;

ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.has_role(_user_id UUID, _role public.app_role)
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id AND role = _role
  )
$$;

CREATE POLICY "Users can view their own roles"
  ON public.user_roles FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Admins can view all roles"
  ON public.user_roles FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins can manage roles"
  ON public.user_roles FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- Pipeline status enum
CREATE TYPE public.app_pipeline_status AS ENUM (
  'New',
  'Under-Review',
  'Seller-Signed',
  'Buyer-Signed',
  'In-Escrow',
  'CRITICAL_STALL',
  'Closed',
  'Dead'
);

-- Closing pipeline items
CREATE TABLE public.closing_pipeline_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  zip TEXT NOT NULL,
  beds INTEGER CHECK (beds >= 0),
  baths NUMERIC(3,1) CHECK (baths >= 0),
  sqft INTEGER CHECK (sqft > 0),
  year_built INTEGER CHECK (year_built BETWEEN 1800 AND 2100),
  base_contract_price NUMERIC(14,2) NOT NULL CHECK (base_contract_price > 0),
  optimized_acquisition_premium NUMERIC(14,2) CHECK (optimized_acquisition_premium >= 0),
  status public.app_pipeline_status NOT NULL DEFAULT 'New',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.closing_pipeline_items TO authenticated;
GRANT ALL ON public.closing_pipeline_items TO service_role;

ALTER TABLE public.closing_pipeline_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Owners can manage their pipeline items"
  ON public.closing_pipeline_items FOR ALL
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Admins can view all pipeline items"
  ON public.closing_pipeline_items FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

-- updated_at trigger
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER update_closing_pipeline_items_updated_at
  BEFORE UPDATE ON public.closing_pipeline_items
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE INDEX idx_closing_pipeline_items_user_id ON public.closing_pipeline_items(user_id);
CREATE INDEX idx_closing_pipeline_items_status ON public.closing_pipeline_items(status);
