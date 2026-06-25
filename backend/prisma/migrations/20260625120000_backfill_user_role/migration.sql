-- Backfill user yang role-nya NULL (bug: INSERT eksplisit NULL mengabaikan DEFAULT)
UPDATE "User" SET role = 'operator' WHERE role IS NULL;

ALTER TABLE "User" ALTER COLUMN "role" SET DEFAULT 'operator';
ALTER TABLE "User" ALTER COLUMN "role" SET NOT NULL;
