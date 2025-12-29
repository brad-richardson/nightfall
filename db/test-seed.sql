-- Seed minimal test data for UI tests
-- This creates a small test region with minimal data

-- Create test region (Bar Harbor, ME Demo)
-- Demo region has higher difficulty (2.5x decay rate) to make the small area more challenging
INSERT INTO regions (region_id, name, boundary, center, distance_from_center, pool_food, pool_equipment, pool_energy, pool_materials, crew_count, difficulty_multiplier)
VALUES (
  'bar_harbor_me_usa_demo',
  'Bar Harbor, ME, USA (Demo)',
  ST_GeomFromText('POLYGON((-68.30 44.35, -68.20 44.35, -68.20 44.42, -68.30 44.42, -68.30 44.35))', 4326),
  ST_GeomFromText('POINT(-68.25 44.385)', 4326),
  0.1,
  2000,
  2000,
  2000,
  2000,
  10,
  2.5
)
ON CONFLICT (region_id) DO NOTHING;

-- Insert world_meta overture release (for pmtiles)
INSERT INTO world_meta (key, value)
VALUES ('overture_release', '"2024-11-13.0"')
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;
