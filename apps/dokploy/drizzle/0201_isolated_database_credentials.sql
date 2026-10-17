ALTER TABLE "mongo" ADD COLUMN IF NOT EXISTS "databaseName" text;
UPDATE "mongo" SET "databaseName" = 'app' WHERE "databaseName" IS NULL;
