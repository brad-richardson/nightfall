-- migrate:up
ALTER TABLE feature_state ALTER COLUMN health TYPE REAL;

-- migrate:down
ALTER TABLE feature_state ALTER COLUMN health TYPE SMALLINT;
