-- Manual fallback for Supabase SQL Editor when `prisma db push` cannot connect.
-- Run this once before using the Alerts / Document Review feature.

DO $$ BEGIN
  CREATE TYPE "DocumentAction" AS ENUM (
    'CREATE_PURCHASE',
    'CREATE_INVOICE',
    'CREATE_EXPENSE',
    'ARCHIVE_ONLY',
    'REJECT'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "AlertType" AS ENUM (
    'DOCUMENT',
    'VAT',
    'REVENUE',
    'EXPENSE',
    'PROJECT',
    'DATA_QUALITY'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "AlertSeverity" AS ENUM (
    'INFO',
    'WARNING',
    'CRITICAL'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "AlertStatus" AS ENUM (
    'ACTIVE',
    'RESOLVED',
    'SNOOZED'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE "documents"
  ADD COLUMN IF NOT EXISTS "confidence" DECIMAL(5, 2),
  ADD COLUMN IF NOT EXISTS "suggestedAction" "DocumentAction",
  ADD COLUMN IF NOT EXISTS "duplicateOfId" TEXT,
  ADD COLUMN IF NOT EXISTS "riskFlags" JSONB,
  ADD COLUMN IF NOT EXISTS "reviewedById" TEXT,
  ADD COLUMN IF NOT EXISTS "reviewedAt" TIMESTAMP(3);

DO $$ BEGIN
  ALTER TABLE "documents"
    ADD CONSTRAINT "documents_reviewedById_fkey"
    FOREIGN KEY ("reviewedById") REFERENCES "users"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "alerts" (
  "id" TEXT NOT NULL,
  "type" "AlertType" NOT NULL,
  "severity" "AlertSeverity" NOT NULL DEFAULT 'WARNING',
  "status" "AlertStatus" NOT NULL DEFAULT 'ACTIVE',
  "title" TEXT NOT NULL,
  "description" TEXT NOT NULL,
  "metadata" JSONB,
  "documentId" TEXT,
  "invoiceId" TEXT,
  "purchaseId" TEXT,
  "projectId" TEXT,
  "createdById" TEXT,
  "detectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "resolvedAt" TIMESTAMP(3),
  "snoozedUntil" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "alerts_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "alerts_status_severity_idx" ON "alerts"("status", "severity");
CREATE INDEX IF NOT EXISTS "alerts_type_status_idx" ON "alerts"("type", "status");

DO $$ BEGIN
  ALTER TABLE "alerts"
    ADD CONSTRAINT "alerts_documentId_fkey"
    FOREIGN KEY ("documentId") REFERENCES "documents"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "alerts"
    ADD CONSTRAINT "alerts_invoiceId_fkey"
    FOREIGN KEY ("invoiceId") REFERENCES "invoices"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "alerts"
    ADD CONSTRAINT "alerts_purchaseId_fkey"
    FOREIGN KEY ("purchaseId") REFERENCES "purchases"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "alerts"
    ADD CONSTRAINT "alerts_projectId_fkey"
    FOREIGN KEY ("projectId") REFERENCES "projects"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "alerts"
    ADD CONSTRAINT "alerts_createdById_fkey"
    FOREIGN KEY ("createdById") REFERENCES "users"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
