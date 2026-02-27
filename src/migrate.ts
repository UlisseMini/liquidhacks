import postgres from 'postgres';

const sql = postgres(process.env.DATABASE_URL!);

async function main() {
  console.log('Running migrations...');

  await sql`
    ALTER TABLE listings
    ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'active'
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS direct_messages (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      sender_id uuid NOT NULL REFERENCES users(id),
      receiver_id uuid NOT NULL REFERENCES users(id),
      body text NOT NULL,
      created_at timestamp DEFAULT now() NOT NULL
    )
  `;

  await sql`
    CREATE INDEX IF NOT EXISTS dm_conv_idx
    ON direct_messages (sender_id, receiver_id, created_at)
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS outreach (
      devpost_profile text PRIMARY KEY,
      reached_out_at timestamp DEFAULT now() NOT NULL
    )
  `;

  console.log('Migrations done');
  await sql.end();
}

main().catch(e => { console.error('Migration failed:', e); process.exit(1); });
