-- Lodging data is additive; existing products remain retail goods.
CREATE EXTENSION IF NOT EXISTS btree_gist;
ALTER TABLE products ADD COLUMN accommodation jsonb;
ALTER TABLE products ADD CONSTRAINT products_accommodation_object CHECK (accommodation IS NULL OR jsonb_typeof(accommodation) = 'object');
CREATE TABLE stay_requests (
  id uuid PRIMARY KEY, workspace_id uuid NOT NULL REFERENCES workspaces(id),
  property_id uuid NOT NULL, property_name text NOT NULL,
  client_request_id uuid NOT NULL, fingerprint text NOT NULL,
  guest_name text NOT NULL, guest_phone text NOT NULL,
  check_in date NOT NULL, check_out date NOT NULL,
  party jsonb NOT NULL, quote jsonb NOT NULL,
  status text NOT NULL DEFAULT 'requested' CHECK (status IN ('requested','reviewing','confirmed','cancelled')),
  agreed_total bigint CHECK (agreed_total IS NULL OR agreed_total >= 0),
  note text NOT NULL DEFAULT '', version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT stay_requests_valid_dates CHECK (check_out > check_in AND check_out - check_in <= 90),
  CONSTRAINT stay_requests_confirmed_price CHECK (status <> 'confirmed' OR agreed_total IS NOT NULL),
  CONSTRAINT stay_requests_property_tenant_fk FOREIGN KEY (workspace_id, property_id) REFERENCES products(workspace_id, id),
  CONSTRAINT stay_requests_request_unique UNIQUE (workspace_id, client_request_id),
  CONSTRAINT stay_requests_no_confirmed_overlap EXCLUDE USING gist
    (workspace_id WITH =, property_id WITH =, daterange(check_in, check_out, '[)') WITH &&)
    WHERE (status = 'confirmed')
);
CREATE INDEX stay_requests_property_dates_idx ON stay_requests(workspace_id, property_id, check_in, check_out);
ALTER TABLE stay_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE stay_requests FORCE ROW LEVEL SECURITY;
CREATE POLICY stay_requests_tenant ON stay_requests TO app_tenant
  USING (workspace_id = current_setting('app.workspace_id', true)::uuid)
  WITH CHECK (workspace_id = current_setting('app.workspace_id', true)::uuid);
GRANT SELECT, INSERT, UPDATE, DELETE ON stay_requests TO app_tenant;
