-- migrate:up
-- Set initial positions for existing idle crews without positions
-- Places them at the center of their region's hub building
UPDATE crews c
SET current_lng = (hub.bbox_xmin + hub.bbox_xmax) / 2,
    current_lat = (hub.bbox_ymin + hub.bbox_ymax) / 2
FROM hex_cells h
JOIN world_features hub ON hub.gers_id = h.hub_building_gers_id
WHERE c.region_id = h.region_id
  AND h.hub_building_gers_id IS NOT NULL
  AND (c.current_lng IS NULL OR c.current_lat IS NULL);

-- migrate:down
-- No rollback needed (positions are cosmetic and will be set again by ticker)
