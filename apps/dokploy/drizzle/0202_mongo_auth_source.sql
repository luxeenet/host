ALTER TABLE "mongo" ADD COLUMN IF NOT EXISTS "authSource" text DEFAULT 'admin';
UPDATE "mongo" SET "authSource" = 'admin' WHERE "authSource" IS NULL;
