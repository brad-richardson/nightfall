-- migrate:up

-- 1. Add new resource pool columns to regions
ALTER TABLE regions ADD COLUMN pool_food BIGINT NOT NULL DEFAULT 0;
ALTER TABLE regions ADD COLUMN pool_equipment BIGINT NOT NULL DEFAULT 0;
ALTER TABLE regions ADD COLUMN pool_energy BIGINT NOT NULL DEFAULT 0;
-- pool_materials already exists

-- 2. Add new generation flags to world_features
ALTER TABLE world_features ADD COLUMN generates_food BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE world_features ADD COLUMN generates_equipment BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE world_features ADD COLUMN generates_energy BOOLEAN NOT NULL DEFAULT FALSE;
-- generates_materials already exists

-- 3. Migrate existing labor buildings to food (restaurants etc were labeled as labor)
UPDATE world_features SET generates_food = generates_labor WHERE generates_labor = TRUE;

-- 4. Drop old labor columns from world_features and regions
ALTER TABLE world_features DROP COLUMN generates_labor;
ALTER TABLE regions DROP COLUMN pool_labor;

-- 5. Add new task cost columns
ALTER TABLE tasks ADD COLUMN cost_food INT NOT NULL DEFAULT 0;
ALTER TABLE tasks ADD COLUMN cost_equipment INT NOT NULL DEFAULT 0;
ALTER TABLE tasks ADD COLUMN cost_energy INT NOT NULL DEFAULT 0;
-- cost_materials already exists

-- 6. Drop old cost_labor column from tasks
ALTER TABLE tasks DROP COLUMN cost_labor;

-- migrate:down

-- Reverse: Add back labor columns
ALTER TABLE tasks ADD COLUMN cost_labor INT NOT NULL DEFAULT 0;
ALTER TABLE tasks DROP COLUMN cost_energy;
ALTER TABLE tasks DROP COLUMN cost_equipment;
ALTER TABLE tasks DROP COLUMN cost_food;

ALTER TABLE regions ADD COLUMN pool_labor BIGINT NOT NULL DEFAULT 0;
ALTER TABLE world_features ADD COLUMN generates_labor BOOLEAN NOT NULL DEFAULT FALSE;

-- Migrate food back to labor
UPDATE world_features SET generates_labor = generates_food WHERE generates_food = TRUE;

ALTER TABLE world_features DROP COLUMN generates_energy;
ALTER TABLE world_features DROP COLUMN generates_equipment;
ALTER TABLE world_features DROP COLUMN generates_food;

ALTER TABLE regions DROP COLUMN pool_energy;
ALTER TABLE regions DROP COLUMN pool_equipment;
ALTER TABLE regions DROP COLUMN pool_food;
