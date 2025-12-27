-- migrate:up

-- Connectors are graph nodes (Overture connector gers_ids)
-- These are intersection points where road segments meet
CREATE TABLE road_connectors (
  connector_id TEXT PRIMARY KEY,  -- Overture connector gers_id
  lng DOUBLE PRECISION NOT NULL,
  lat DOUBLE PRECISION NOT NULL,
  h3_index TEXT,  -- For efficient per-hex queries (nullable, set after hex_cells exist)
  region_id TEXT REFERENCES regions(region_id) ON DELETE CASCADE
);

CREATE INDEX road_connectors_h3_idx ON road_connectors(h3_index);
CREATE INDEX road_connectors_region_idx ON road_connectors(region_id);
CREATE INDEX road_connectors_location_idx ON road_connectors(lng, lat);

-- Edges connect two connectors via a road segment
-- Each road segment creates one bidirectional edge (stored as two directed edges)
CREATE TABLE road_edges (
  segment_gers_id TEXT NOT NULL REFERENCES world_features(gers_id) ON DELETE CASCADE,
  from_connector TEXT NOT NULL REFERENCES road_connectors(connector_id) ON DELETE CASCADE,
  to_connector TEXT NOT NULL REFERENCES road_connectors(connector_id) ON DELETE CASCADE,
  length_meters DOUBLE PRECISION NOT NULL,
  h3_index TEXT,  -- Primary hex this edge is in (for queries)
  PRIMARY KEY (segment_gers_id, from_connector, to_connector)
);

CREATE INDEX road_edges_h3_idx ON road_edges(h3_index);
CREATE INDEX road_edges_from_idx ON road_edges(from_connector);
CREATE INDEX road_edges_to_idx ON road_edges(to_connector);

-- migrate:down

DROP TABLE IF EXISTS road_edges;
DROP TABLE IF EXISTS road_connectors;
