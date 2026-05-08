require('dotenv').config();
const { Client } = require('pg');

async function main() {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  console.log('Connected to DB');

  await client.query(`
    DO $$ BEGIN
      CREATE TYPE "GmailMessageStatus" AS ENUM ('PENDING', 'CLASSIFIED', 'IGNORED');
    EXCEPTION WHEN duplicate_object THEN NULL;
    END $$;
  `);

  await client.query(`
    CREATE TABLE IF NOT EXISTS gmail_messages (
      id               TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
      "messageId"      TEXT UNIQUE NOT NULL,
      "threadId"       TEXT,
      subject          TEXT NOT NULL DEFAULT '',
      "from"           TEXT,
      snippet          TEXT,
      date             TIMESTAMPTZ,
      "hasAttachments" BOOLEAN NOT NULL DEFAULT false,
      "attachmentNames" TEXT[] NOT NULL DEFAULT '{}',
      "bodyText"       TEXT,
      status           "GmailMessageStatus" NOT NULL DEFAULT 'PENDING',
      classification   TEXT,
      "classifiedType" TEXT,
      notes            TEXT,
      "reviewedAt"     TIMESTAMPTZ,
      "reviewedById"   TEXT,
      "documentId"     TEXT,
      "createdAt"      TIMESTAMPTZ NOT NULL DEFAULT now(),
      "updatedAt"      TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
  console.log('✓ gmail_messages table created');

  // Create updatedAt trigger
  await client.query(`
    CREATE OR REPLACE FUNCTION update_gmail_messages_updated_at()
    RETURNS TRIGGER AS $$
    BEGIN NEW."updatedAt" = now(); RETURN NEW; END;
    $$ LANGUAGE plpgsql;
  `);
  await client.query(`
    DROP TRIGGER IF EXISTS set_gmail_messages_updated_at ON gmail_messages;
    CREATE TRIGGER set_gmail_messages_updated_at
      BEFORE UPDATE ON gmail_messages
      FOR EACH ROW EXECUTE FUNCTION update_gmail_messages_updated_at();
  `);
  console.log('✓ trigger created');

  await client.end();
  console.log('Done!');
}

main().catch(e => { console.error(e); process.exit(1); });
