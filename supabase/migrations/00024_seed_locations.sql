-- Seed the coordinator's real teaching locations so student/lesson dropdowns
-- aren't limited to just "Online". Idempotent — each only inserts if absent.
-- (These can be renamed/removed from the Locations page.)

INSERT INTO locations (name, address, city, zone)
SELECT v.name, '', '', ''
FROM (VALUES ('Links'), ('Edvin'), ('Student''s Home')) AS v(name)
WHERE NOT EXISTS (SELECT 1 FROM locations l WHERE l.name = v.name);
