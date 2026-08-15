import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import * as schema from "./schema";

// A local file URL lets Next.js analyze route modules during a credentials-free
// production build. Hosted requests still validate TURSO_DATABASE_URL below.
const databaseUrl = process.env.TURSO_DATABASE_URL ?? "file:local.db";

const client = createClient({
  url: databaseUrl,
  authToken: process.env.TURSO_AUTH_TOKEN,
});

const db = drizzle(client, { schema });

export function getDb() {
  return db;
}

const setupStatements = [
  `CREATE TABLE IF NOT EXISTS players (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, normalized_name TEXT, level TEXT NOT NULL DEFAULT 'C',
    contact TEXT, gender TEXT NOT NULL DEFAULT 'unspecified', notes TEXT,
    times_played INTEGER NOT NULL DEFAULT 0, total_bill_centavos INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL, updated_at INTEGER
  )`,
  `CREATE TABLE IF NOT EXISTS matches (
    id TEXT PRIMARY KEY, court_id INTEGER NOT NULL, player_names TEXT NOT NULL,
    started_at INTEGER NOT NULL, ended_at INTEGER NOT NULL,
    shuttlecock_name TEXT NOT NULL DEFAULT 'Unknown', shuttlecock_price_centavos INTEGER NOT NULL DEFAULT 0,
    cost_per_player_centavos INTEGER NOT NULL DEFAULT 0, player_costs TEXT NOT NULL DEFAULT '[]',
    reservation_id TEXT, status TEXT NOT NULL DEFAULT 'completed', court_name TEXT, winner_name TEXT,
    queue_order TEXT NOT NULL DEFAULT '[]', managed_by TEXT,
    billing_total_centavos INTEGER NOT NULL DEFAULT 0, billing_summary TEXT NOT NULL DEFAULT '[]',
    substitution_count INTEGER NOT NULL DEFAULT 0, match_notes TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS courts (
    id INTEGER PRIMARY KEY, number INTEGER NOT NULL UNIQUE, name TEXT,
    maintenance INTEGER NOT NULL DEFAULT 0, maintenance_note TEXT, updated_at INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS reservations (
    id TEXT PRIMARY KEY, starts_at INTEGER NOT NULL, ends_at INTEGER NOT NULL, court_id INTEGER,
    customer_player_id TEXT NOT NULL, customer_name TEXT NOT NULL, contact TEXT, player_count INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending', notes TEXT, reservation_type TEXT NOT NULL DEFAULT 'court',
    payment_method TEXT NOT NULL DEFAULT 'unpaid', payment_status TEXT NOT NULL DEFAULT 'unpaid',
    total_fee_centavos INTEGER NOT NULL DEFAULT 0, paid_amount_centavos INTEGER NOT NULL DEFAULT 0,
    source TEXT NOT NULL DEFAULT 'manual', external_id TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS reservation_players (
    reservation_id TEXT NOT NULL, player_id TEXT NOT NULL, UNIQUE(reservation_id, player_id)
  )`,
  `CREATE TABLE IF NOT EXISTS active_games (
    id TEXT PRIMARY KEY, court_id INTEGER NOT NULL UNIQUE, reservation_id TEXT UNIQUE,
    shuttlecock_id TEXT NOT NULL, shuttlecock_name TEXT NOT NULL, shuttlecock_price_centavos INTEGER NOT NULL,
    started_at INTEGER NOT NULL, created_at INTEGER NOT NULL,
    queue_order TEXT NOT NULL DEFAULT '[]', managed_by TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS active_game_players (
    game_id TEXT NOT NULL, player_id TEXT NOT NULL, player_name TEXT NOT NULL,
    player_level TEXT NOT NULL DEFAULT 'C', player_gender TEXT NOT NULL DEFAULT 'unspecified',
    UNIQUE(game_id, player_id)
  )`,
  `CREATE TABLE IF NOT EXISTS match_players (
    match_id TEXT NOT NULL, player_id TEXT NOT NULL, player_name TEXT NOT NULL,
    player_level TEXT NOT NULL DEFAULT 'C', player_gender TEXT NOT NULL DEFAULT 'unspecified',
    winner INTEGER NOT NULL DEFAULT 0, cost_centavos INTEGER NOT NULL,
    UNIQUE(match_id, player_id)
  )`,
  `CREATE TABLE IF NOT EXISTS queue_entries (
    id TEXT PRIMARY KEY, player_id TEXT NOT NULL, player_name TEXT NOT NULL,
    player_level TEXT NOT NULL DEFAULT 'C', player_gender TEXT NOT NULL DEFAULT 'unspecified',
    joined_at INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'waiting', standby_table_number INTEGER,
    reservation_id TEXT, notes TEXT, updated_at INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS activity_logs (
    id TEXT PRIMARY KEY, type TEXT NOT NULL, player_id TEXT, player_name TEXT, court_id INTEGER,
    game_id TEXT, reservation_id TEXT, details TEXT NOT NULL DEFAULT '{}', managed_by TEXT, created_at INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS game_billings (
    game_id TEXT NOT NULL, player_id TEXT NOT NULL, player_name TEXT NOT NULL,
    bet_amount_centavos INTEGER NOT NULL DEFAULT 0, shuttlecock_contribution_centavos INTEGER NOT NULL DEFAULT 0,
    shuttlecock_payer INTEGER NOT NULL DEFAULT 0, additional_charges TEXT NOT NULL DEFAULT '[]',
    additional_total_centavos INTEGER NOT NULL DEFAULT 0, total_due_centavos INTEGER NOT NULL DEFAULT 0,
    payment_status TEXT NOT NULL DEFAULT 'unpaid', winner INTEGER NOT NULL DEFAULT 0, notes TEXT,
    status TEXT NOT NULL DEFAULT 'active', updated_at INTEGER NOT NULL, UNIQUE(game_id, player_id)
  )`,
  `CREATE TABLE IF NOT EXISTS player_payments (
    id TEXT PRIMARY KEY, player_id TEXT NOT NULL, amount_centavos INTEGER NOT NULL,
    method TEXT NOT NULL DEFAULT 'cash', notes TEXT, added_by TEXT, created_at INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS player_charges (
    id TEXT PRIMARY KEY, player_id TEXT NOT NULL, type TEXT NOT NULL, description TEXT NOT NULL,
    amount_centavos INTEGER NOT NULL, added_by TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
  )`,
  "CREATE INDEX IF NOT EXISTS players_name_idx ON players(name)",
  "CREATE INDEX IF NOT EXISTS players_contact_idx ON players(contact)",
  "CREATE UNIQUE INDEX IF NOT EXISTS players_normalized_name_unique ON players(normalized_name)",
  "CREATE INDEX IF NOT EXISTS matches_ended_at_idx ON matches(ended_at)",
  "CREATE INDEX IF NOT EXISTS matches_court_idx ON matches(court_id)",
  "CREATE INDEX IF NOT EXISTS matches_shuttlecock_idx ON matches(shuttlecock_name)",
  "CREATE INDEX IF NOT EXISTS reservations_starts_at_idx ON reservations(starts_at)",
  "CREATE INDEX IF NOT EXISTS reservations_status_idx ON reservations(status)",
  "CREATE INDEX IF NOT EXISTS reservations_court_idx ON reservations(court_id)",
  "CREATE INDEX IF NOT EXISTS reservations_player_idx ON reservations(customer_player_id)",
  "CREATE INDEX IF NOT EXISTS reservations_payment_idx ON reservations(payment_status)",
  "CREATE UNIQUE INDEX IF NOT EXISTS reservations_source_external_unique ON reservations(source, external_id)",
  "CREATE INDEX IF NOT EXISTS reservation_players_player_idx ON reservation_players(player_id)",
  "CREATE INDEX IF NOT EXISTS match_players_player_idx ON match_players(player_id)",
  "CREATE INDEX IF NOT EXISTS match_players_match_idx ON match_players(match_id)",
  "CREATE INDEX IF NOT EXISTS queue_entries_status_joined_idx ON queue_entries(status, joined_at)",
  "CREATE INDEX IF NOT EXISTS queue_entries_player_idx ON queue_entries(player_id)",
  "CREATE INDEX IF NOT EXISTS activity_logs_created_idx ON activity_logs(created_at)",
  "CREATE INDEX IF NOT EXISTS activity_logs_player_idx ON activity_logs(player_id)",
  "CREATE INDEX IF NOT EXISTS activity_logs_game_idx ON activity_logs(game_id)",
  "CREATE INDEX IF NOT EXISTS game_billings_player_idx ON game_billings(player_id)",
  "CREATE INDEX IF NOT EXISTS game_billings_status_idx ON game_billings(status)",
  "CREATE INDEX IF NOT EXISTS player_payments_player_created_idx ON player_payments(player_id, created_at)",
  "CREATE INDEX IF NOT EXISTS player_charges_player_created_idx ON player_charges(player_id, created_at)",
];

let tablesReady: Promise<void> | null = null;

export function ensureTables() {
  if (process.env.VERCEL && !process.env.TURSO_DATABASE_URL) {
    throw new Error("TURSO_DATABASE_URL is required on Vercel.");
  }
  if (!tablesReady) {
    tablesReady = (async () => {
      await client.batch(setupStatements, "write");
      const now = Date.now();
      await client.batch(
        Array.from({ length: 9 }, (_, index) => ({
          sql: "INSERT OR IGNORE INTO courts (id, number, maintenance, updated_at) VALUES (?, ?, 0, ?)",
          args: [index + 1, index + 1, now],
        })),
        "write",
      );
    })();
  }
  return tablesReady;
}
