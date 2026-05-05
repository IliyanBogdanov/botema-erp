-- Studio Botema ERP — Normalized Business Data Layer
-- Run in Supabase SQL Editor to add counterparties, orders, payments, reconciliation etc.

-- ─── ENUMS ───────────────────────────────────────────────────────────────────

DO $$ BEGIN CREATE TYPE "CounterpartyType" AS ENUM ('CLIENT','SUPPLIER','COURIER','BANK','ACCOUNTING','OTHER'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE "SourceType" AS ENUM ('DRIVE','GMAIL','MANUAL'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE "BizDocType" AS ENUM ('INVOICE_OUT','INVOICE_IN','PROFORMA_OUT','PROFORMA_IN','OFFER_OUT','OFFER_IN','CREDIT_NOTE','DELIVERY_NOTE','CMR','PROTOCOL','CUSTOMS','BANK_STATEMENT','OTHER'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE "BizDocStatus" AS ENUM ('NEW','NEEDS_REVIEW','REVIEWED','IMPORTED','MATCHED','ARCHIVED','REJECTED'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE "VatType" AS ENUM ('STANDARD_BG','EU_INTRA','REVERSE_CHARGE','EXEMPT','NON_VAT','IMPORT'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE "OrderType" AS ENUM ('CLIENT_ORDER','SUPPLIER_ORDER'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE "OrderStatus" AS ENUM ('OPEN','PARTIAL','FULFILLED','CANCELLED'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE "DeliveryType" AS ENUM ('INBOUND','OUTBOUND','RETURN'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE "DeliveryStatus" AS ENUM ('IN_TRANSIT','DELIVERED','PARTIAL','RETURNED','CANCELLED'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE "PaymentType" AS ENUM ('BANK_TRANSFER','COD','CARD','CASH','OTHER'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE "PaymentMatchStatus" AS ENUM ('UNMATCHED','PARTIAL','MATCHED'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE "LinkType" AS ENUM ('PAYMENT_TO_INVOICE','INVOICE_TO_DELIVERY','DELIVERY_TO_ORDER','ORDER_TO_PROJECT','DOCUMENT_TO_SOURCE','EMAIL_TO_DOCUMENT','PARTIAL_MATCH'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE "MissingType" AS ENUM ('ADVANCE_INVOICE','FINAL_INVOICE','DELIVERY_NOTE','PAYMENT_PROOF','CUSTOMS_DOC','OTHER'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE "MissingStatus" AS ENUM ('OPEN','FOUND','WRITTEN_OFF'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE "CoverageSource" AS ENUM ('DRIVE','GMAIL'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE "CoverageStatus" AS ENUM ('PENDING','IN_PROGRESS','DONE','PARTIAL'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ─── COUNTERPARTIES ──────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "counterparties" (
  "id"           TEXT NOT NULL,
  "name"         TEXT NOT NULL,
  "type"         "CounterpartyType" NOT NULL,
  "subtype"      TEXT,
  "eik"          TEXT,
  "vat"          TEXT,
  "country"      TEXT NOT NULL DEFAULT 'BG',
  "currency"     TEXT NOT NULL DEFAULT 'BGN',
  "address"      TEXT,
  "city"         TEXT,
  "email"        TEXT,
  "phone"        TEXT,
  "notes"        TEXT,
  "companyId"    TEXT,
  "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "counterparties_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "counterparties_type_idx" ON "counterparties"("type");
CREATE INDEX IF NOT EXISTS "counterparties_name_idx" ON "counterparties"("name");

-- ─── CONTACTS ────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "contacts" (
  "id"              TEXT NOT NULL,
  "counterpartyId"  TEXT NOT NULL,
  "name"            TEXT NOT NULL,
  "email"           TEXT,
  "phone"           TEXT,
  "role"            TEXT,
  "notes"           TEXT,
  "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "contacts_pkey" PRIMARY KEY ("id")
);
DO $$ BEGIN ALTER TABLE "contacts" ADD CONSTRAINT "contacts_counterpartyId_fkey" FOREIGN KEY ("counterpartyId") REFERENCES "counterparties"("id") ON DELETE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ─── EMAIL THREADS ────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "email_threads" (
  "id"              TEXT NOT NULL,
  "threadId"        TEXT NOT NULL,
  "subject"         TEXT NOT NULL,
  "fromEmail"       TEXT,
  "counterpartyId"  TEXT,
  "lastMessageAt"   TIMESTAMP(3),
  "messageCount"    INTEGER NOT NULL DEFAULT 1,
  "hasAttachments"  BOOLEAN NOT NULL DEFAULT false,
  "notes"           TEXT,
  "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "email_threads_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "email_threads_threadId_key" UNIQUE ("threadId")
);

-- ─── SOURCE FILES ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "source_files" (
  "id"            TEXT NOT NULL,
  "type"          "SourceType" NOT NULL,
  "driveFileId"   TEXT,
  "driveUrl"      TEXT,
  "gmailMsgId"    TEXT,
  "gmailThread"   TEXT,
  "filename"      TEXT NOT NULL,
  "mimeType"      TEXT,
  "folder"        TEXT,
  "subject"       TEXT,
  "fromEmail"     TEXT,
  "receivedAt"    TIMESTAMP(3),
  "processedAt"   TIMESTAMP(3),
  "notes"         TEXT,
  "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "source_files_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "source_files_driveFileId_key" UNIQUE ("driveFileId"),
  CONSTRAINT "source_files_gmailMsgId_key" UNIQUE ("gmailMsgId")
);
DO $$ BEGIN ALTER TABLE "source_files" ADD CONSTRAINT "source_files_gmailThread_fkey" FOREIGN KEY ("gmailThread") REFERENCES "email_threads"("threadId") ON DELETE SET NULL; EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ─── BIZ DOCUMENTS ────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "biz_documents" (
  "id"              TEXT NOT NULL,
  "companyId"       TEXT,
  "counterpartyId"  TEXT,
  "projectId"       TEXT,
  "sourceFileId"    TEXT,
  "docType"         "BizDocType" NOT NULL,
  "docNumber"       TEXT,
  "docDate"         TIMESTAMP(3),
  "dueDate"         TIMESTAMP(3),
  "currency"        TEXT NOT NULL DEFAULT 'BGN',
  "amountNet"       DECIMAL(14,4),
  "vatAmount"       DECIMAL(14,4),
  "amountTotal"     DECIMAL(14,4),
  "vatType"         "VatType" NOT NULL DEFAULT 'STANDARD_BG',
  "status"          "BizDocStatus" NOT NULL DEFAULT 'NEW',
  "confidence"      DECIMAL(5,2),
  "notes"           TEXT,
  "internalRef"     TEXT,
  "externalRef"     TEXT,
  "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "biz_documents_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "biz_documents_docType_status_idx" ON "biz_documents"("docType", "status");
CREATE INDEX IF NOT EXISTS "biz_documents_counterpartyId_idx" ON "biz_documents"("counterpartyId");
CREATE INDEX IF NOT EXISTS "biz_documents_docDate_idx" ON "biz_documents"("docDate");
DO $$ BEGIN ALTER TABLE "biz_documents" ADD CONSTRAINT "biz_documents_counterpartyId_fkey" FOREIGN KEY ("counterpartyId") REFERENCES "counterparties"("id") ON DELETE SET NULL; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "biz_documents" ADD CONSTRAINT "biz_documents_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE SET NULL; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "biz_documents" ADD CONSTRAINT "biz_documents_sourceFileId_fkey" FOREIGN KEY ("sourceFileId") REFERENCES "source_files"("id") ON DELETE SET NULL; EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ─── BIZ DOCUMENT LINES ──────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "biz_document_lines" (
  "id"          TEXT NOT NULL,
  "docId"       TEXT NOT NULL,
  "lineNo"      INTEGER,
  "code"        TEXT,
  "description" TEXT NOT NULL,
  "qty"         DECIMAL(12,4),
  "unit"        TEXT,
  "unitPrice"   DECIMAL(14,4),
  "vatPct"      DECIMAL(5,2),
  "total"       DECIMAL(14,4),
  "notes"       TEXT,
  CONSTRAINT "biz_document_lines_pkey" PRIMARY KEY ("id")
);
DO $$ BEGIN ALTER TABLE "biz_document_lines" ADD CONSTRAINT "biz_document_lines_docId_fkey" FOREIGN KEY ("docId") REFERENCES "biz_documents"("id") ON DELETE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ─── ORDERS ──────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "orders" (
  "id"            TEXT NOT NULL,
  "companyId"     TEXT,
  "clientId"      TEXT,
  "supplierId"    TEXT,
  "projectId"     TEXT,
  "orderType"     "OrderType" NOT NULL,
  "orderNo"       TEXT,
  "orderDate"     TIMESTAMP(3),
  "currency"      TEXT NOT NULL DEFAULT 'EUR',
  "amountTotal"   DECIMAL(14,4),
  "status"        "OrderStatus" NOT NULL DEFAULT 'OPEN',
  "notes"         TEXT,
  "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "orders_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "orders_orderType_status_idx" ON "orders"("orderType", "status");
DO $$ BEGIN ALTER TABLE "orders" ADD CONSTRAINT "orders_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "counterparties"("id") ON DELETE SET NULL; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "orders" ADD CONSTRAINT "orders_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "counterparties"("id") ON DELETE SET NULL; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "orders" ADD CONSTRAINT "orders_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE SET NULL; EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ─── ORDER LINES ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "order_lines" (
  "id"          TEXT NOT NULL,
  "orderId"     TEXT NOT NULL,
  "lineNo"      INTEGER,
  "code"        TEXT,
  "description" TEXT NOT NULL,
  "qty"         DECIMAL(12,4) NOT NULL,
  "unit"        TEXT,
  "unitPrice"   DECIMAL(14,4) NOT NULL,
  "currency"    TEXT NOT NULL DEFAULT 'EUR',
  "notes"       TEXT,
  CONSTRAINT "order_lines_pkey" PRIMARY KEY ("id")
);
DO $$ BEGIN ALTER TABLE "order_lines" ADD CONSTRAINT "order_lines_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ─── DELIVERIES ──────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "deliveries" (
  "id"              TEXT NOT NULL,
  "orderId"         TEXT,
  "counterpartyId"  TEXT,
  "projectId"       TEXT,
  "deliveryType"    "DeliveryType" NOT NULL,
  "deliveryNo"      TEXT,
  "deliveryDate"    TIMESTAMP(3),
  "courier"         TEXT,
  "trackingNo"      TEXT,
  "status"          "DeliveryStatus" NOT NULL DEFAULT 'IN_TRANSIT',
  "hasInvoice"      BOOLEAN NOT NULL DEFAULT false,
  "invoiceValue"    DECIMAL(14,4),
  "currency"        TEXT NOT NULL DEFAULT 'EUR',
  "notes"           TEXT,
  "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "deliveries_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "deliveries_deliveryType_status_idx" ON "deliveries"("deliveryType", "status");
DO $$ BEGIN ALTER TABLE "deliveries" ADD CONSTRAINT "deliveries_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE SET NULL; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "deliveries" ADD CONSTRAINT "deliveries_counterpartyId_fkey" FOREIGN KEY ("counterpartyId") REFERENCES "counterparties"("id") ON DELETE SET NULL; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "deliveries" ADD CONSTRAINT "deliveries_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE SET NULL; EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ─── PAYMENTS ────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "payments" (
  "id"              TEXT NOT NULL,
  "companyId"       TEXT,
  "counterpartyId"  TEXT,
  "projectId"       TEXT,
  "paymentType"     "PaymentType" NOT NULL,
  "paymentDate"     TIMESTAMP(3) NOT NULL,
  "amount"          DECIMAL(14,4) NOT NULL,
  "currency"        TEXT NOT NULL DEFAULT 'BGN',
  "reference"       TEXT,
  "bankAccount"     TEXT,
  "status"          "PaymentMatchStatus" NOT NULL DEFAULT 'UNMATCHED',
  "notes"           TEXT,
  "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "payments_paymentType_status_idx" ON "payments"("paymentType", "status");
CREATE INDEX IF NOT EXISTS "payments_paymentDate_idx" ON "payments"("paymentDate");
DO $$ BEGIN ALTER TABLE "payments" ADD CONSTRAINT "payments_counterpartyId_fkey" FOREIGN KEY ("counterpartyId") REFERENCES "counterparties"("id") ON DELETE SET NULL; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "payments" ADD CONSTRAINT "payments_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE SET NULL; EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ─── RECONCILIATION LINKS ────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "reconciliation_links" (
  "id"            TEXT NOT NULL,
  "sourceDocId"   TEXT,
  "targetDocId"   TEXT,
  "paymentId"     TEXT,
  "linkType"      "LinkType" NOT NULL,
  "amountLinked"  DECIMAL(14,4),
  "currency"      TEXT,
  "confidence"    DECIMAL(5,2),
  "notes"         TEXT,
  "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "reconciliation_links_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "reconciliation_links_linkType_idx" ON "reconciliation_links"("linkType");
DO $$ BEGIN ALTER TABLE "reconciliation_links" ADD CONSTRAINT "reconciliation_links_sourceDocId_fkey" FOREIGN KEY ("sourceDocId") REFERENCES "biz_documents"("id") ON DELETE SET NULL; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "reconciliation_links" ADD CONSTRAINT "reconciliation_links_targetDocId_fkey" FOREIGN KEY ("targetDocId") REFERENCES "biz_documents"("id") ON DELETE SET NULL; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "reconciliation_links" ADD CONSTRAINT "reconciliation_links_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "payments"("id") ON DELETE SET NULL; EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ─── MISSING DOCUMENTS ───────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "missing_documents" (
  "id"              TEXT NOT NULL,
  "counterpartyId"  TEXT,
  "projectId"       TEXT,
  "relatedDocId"    TEXT,
  "missingType"     "MissingType" NOT NULL,
  "description"     TEXT NOT NULL,
  "expectedAmount"  DECIMAL(14,4),
  "currency"        TEXT,
  "status"          "MissingStatus" NOT NULL DEFAULT 'OPEN',
  "notes"           TEXT,
  "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "missing_documents_pkey" PRIMARY KEY ("id")
);
DO $$ BEGIN ALTER TABLE "missing_documents" ADD CONSTRAINT "missing_documents_counterpartyId_fkey" FOREIGN KEY ("counterpartyId") REFERENCES "counterparties"("id") ON DELETE SET NULL; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "missing_documents" ADD CONSTRAINT "missing_documents_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE SET NULL; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "missing_documents" ADD CONSTRAINT "missing_documents_relatedDocId_fkey" FOREIGN KEY ("relatedDocId") REFERENCES "biz_documents"("id") ON DELETE SET NULL; EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ─── COVERAGE ────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "coverage" (
  "id"          TEXT NOT NULL,
  "source"      "CoverageSource" NOT NULL,
  "path"        TEXT NOT NULL,
  "year"        INTEGER NOT NULL,
  "status"      "CoverageStatus" NOT NULL DEFAULT 'PENDING',
  "itemsFound"  INTEGER NOT NULL DEFAULT 0,
  "itemsDone"   INTEGER NOT NULL DEFAULT 0,
  "notes"       TEXT,
  "lastRunAt"   TIMESTAMP(3),
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "coverage_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "coverage_source_path_year_key" UNIQUE ("source", "path", "year")
);
