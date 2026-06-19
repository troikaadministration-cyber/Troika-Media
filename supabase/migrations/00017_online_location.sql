-- Add Online as a location so it appears in all location dropdowns.
-- Idempotent: only inserts if no row named 'Online' exists.
INSERT INTO locations (name, address, city, zone)
SELECT 'Online', 'Online', '', ''
WHERE NOT EXISTS (SELECT 1 FROM locations WHERE name = 'Online');
