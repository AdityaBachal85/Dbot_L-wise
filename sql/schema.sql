-- DBOT Land Intelligence — PostGIS schema for the MCGM DP dataset.
-- Idempotent: safe to run against an existing database.

CREATE EXTENSION IF NOT EXISTS postgis;

-- The CTS cadastral index — every other layer joins against this spatially.
CREATE TABLE IF NOT EXISTS dp_parcels (
  id SERIAL PRIMARY KEY,
  cts_cs_no TEXT,
  ward TEXT,
  village TEXT,
  type TEXT,
  geom GEOMETRY(MultiPolygon, 4326) NOT NULL,
  UNIQUE (cts_cs_no, village, ward)
);
CREATE INDEX IF NOT EXISTS idx_dp_parcels_geom ON dp_parcels USING GIST (geom);
CREATE INDEX IF NOT EXISTS idx_dp_parcels_lookup ON dp_parcels (ward, village, cts_cs_no);

-- Every reference layer (zones, reservations, roads, heritage, CRZ, metro,
-- gaothan, height, admin) in one table. Deliberately generic — 31 layers
-- with 31 different attribute schemas isn't worth 31 typed tables. JSONB
-- keeps every source field queryable without a schema migration every
-- time a new layer or field gets confirmed.
CREATE TABLE IF NOT EXISTS dp_layer_features (
  id SERIAL PRIMARY KEY,
  service TEXT NOT NULL,          -- 'DP' | 'DD' | 'AKO' | 'SRA'
  layer_id INT NOT NULL,
  category TEXT NOT NULL,         -- ZONE | RESERVATION | ROAD | HERITAGE | CRZ | HEIGHT | METRO | GAOTHAN | ADMIN
  label TEXT NOT NULL,
  source_objectid BIGINT,
  attributes JSONB,
  geom GEOMETRY(MultiPolygon, 4326),
  UNIQUE (service, layer_id, source_objectid)
);
CREATE INDEX IF NOT EXISTS idx_dp_layer_features_geom ON dp_layer_features USING GIST (geom);
CREATE INDEX IF NOT EXISTS idx_dp_layer_features_category ON dp_layer_features (category);
CREATE INDEX IF NOT EXISTS idx_dp_layer_features_attrs ON dp_layer_features USING GIN (attributes);

-- The query every regulation-engine lookup will actually run: "what
-- reference features touch this parcel, by category?" — no more MCGM
-- API calls needed once this is populated.
--
-- Example:
--   SELECT lf.category, lf.label, lf.attributes
--   FROM dp_parcels p
--   JOIN dp_layer_features lf ON ST_Intersects(p.geom, lf.geom)
--   WHERE p.cts_cs_no = '1/1061' AND p.village = 'BHULESHWAR' AND p.ward = 'C';
