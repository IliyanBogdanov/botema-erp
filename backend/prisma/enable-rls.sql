-- ============================================================
-- Enable Row Level Security on all tables
-- Backend uses service_role key → bypasses RLS automatically
-- Anon/public access is fully blocked
-- ============================================================

-- Enable RLS on all tables
ALTER TABLE users                  ENABLE ROW LEVEL SECURITY;
ALTER TABLE companies              ENABLE ROW LEVEL SECURITY;
ALTER TABLE clients                ENABLE ROW LEVEL SECURITY;
ALTER TABLE suppliers              ENABLE ROW LEVEL SECURITY;
ALTER TABLE projects               ENABLE ROW LEVEL SECURITY;
ALTER TABLE invoices               ENABLE ROW LEVEL SECURITY;
ALTER TABLE invoice_items          ENABLE ROW LEVEL SECURITY;
ALTER TABLE purchases              ENABLE ROW LEVEL SECURITY;
ALTER TABLE purchase_items         ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventory_items        ENABLE ROW LEVEL SECURITY;
ALTER TABLE stock_movements        ENABLE ROW LEVEL SECURITY;
ALTER TABLE expenses               ENABLE ROW LEVEL SECURITY;
ALTER TABLE documents              ENABLE ROW LEVEL SECURITY;
ALTER TABLE alerts                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE gmail_watches          ENABLE ROW LEVEL SECURITY;
ALTER TABLE counterparties         ENABLE ROW LEVEL SECURITY;
ALTER TABLE contacts               ENABLE ROW LEVEL SECURITY;
ALTER TABLE source_files           ENABLE ROW LEVEL SECURITY;
ALTER TABLE email_threads          ENABLE ROW LEVEL SECURITY;
ALTER TABLE biz_documents          ENABLE ROW LEVEL SECURITY;
ALTER TABLE biz_document_lines     ENABLE ROW LEVEL SECURITY;
ALTER TABLE orders                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE order_lines            ENABLE ROW LEVEL SECURITY;
ALTER TABLE deliveries             ENABLE ROW LEVEL SECURITY;
ALTER TABLE payments               ENABLE ROW LEVEL SECURITY;
ALTER TABLE reconciliation_links   ENABLE ROW LEVEL SECURITY;
ALTER TABLE missing_documents      ENABLE ROW LEVEL SECURITY;
ALTER TABLE coverage               ENABLE ROW LEVEL SECURITY;

-- Drop any existing permissive anon policies (clean slate)
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT schemaname, tablename, policyname
    FROM pg_policies
    WHERE schemaname = 'public'
      AND (roles @> ARRAY['anon']::name[] OR roles @> ARRAY['public']::name[])
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I.%I', r.policyname, r.schemaname, r.tablename);
  END LOOP;
END $$;

-- NOTE: No policies needed for anon/authenticated roles.
-- The backend connects with service_role key which bypasses RLS.
-- Direct Supabase API access (anon key) is now fully blocked.

SELECT 'RLS enabled on all tables. Service role key bypasses RLS.' AS status;
