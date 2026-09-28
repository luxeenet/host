-- Add missing is_platform_admin column to user table
ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "is_platform_admin" boolean DEFAULT false NOT NULL;
