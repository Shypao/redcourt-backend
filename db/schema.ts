import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const players = sqliteTable("players", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  normalizedName: text("normalized_name"),
  level: text("level").notNull().default("C"),
  contact: text("contact"),
  gender: text("gender").notNull().default("unspecified"),
  notes: text("notes"),
  timesPlayed: integer("times_played").notNull().default(0),
  totalBillCentavos: integer("total_bill_centavos").notNull().default(0),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at"),
}, (table) => [
  index("players_name_idx").on(table.name),
  index("players_contact_idx").on(table.contact),
  uniqueIndex("players_normalized_name_unique").on(table.normalizedName),
]);

export const matches = sqliteTable("matches", {
  id: text("id").primaryKey(),
  courtId: integer("court_id").notNull(),
  playerNames: text("player_names").notNull(),
  startedAt: integer("started_at").notNull(),
  endedAt: integer("ended_at").notNull(),
  shuttlecockName: text("shuttlecock_name").notNull().default("Unknown"),
  shuttlecockPriceCentavos: integer("shuttlecock_price_centavos").notNull().default(0),
  costPerPlayerCentavos: integer("cost_per_player_centavos").notNull().default(0),
  playerCosts: text("player_costs").notNull().default("[]"),
  reservationId: text("reservation_id"),
  status: text("status").notNull().default("completed"),
  courtName: text("court_name"),
  winnerName: text("winner_name"),
  queueOrder: text("queue_order").notNull().default("[]"),
  managedBy: text("managed_by"),
  billingTotalCentavos: integer("billing_total_centavos").notNull().default(0),
  billingSummary: text("billing_summary").notNull().default("[]"),
  substitutionCount: integer("substitution_count").notNull().default(0),
  matchNotes: text("match_notes"),
}, (table) => [
  index("matches_ended_at_idx").on(table.endedAt),
  index("matches_court_idx").on(table.courtId),
  index("matches_shuttlecock_idx").on(table.shuttlecockName),
]);

export const courts = sqliteTable("courts", {
  id: integer("id").primaryKey(),
  number: integer("number").notNull(),
  name: text("name"),
  maintenance: integer("maintenance", { mode: "boolean" }).notNull().default(false),
  maintenanceNote: text("maintenance_note"),
  updatedAt: integer("updated_at").notNull(),
}, (table) => [uniqueIndex("courts_number_unique").on(table.number)]);

export const reservations = sqliteTable("reservations", {
  id: text("id").primaryKey(),
  startsAt: integer("starts_at").notNull(),
  endsAt: integer("ends_at").notNull(),
  courtId: integer("court_id"),
  customerPlayerId: text("customer_player_id").notNull(),
  customerName: text("customer_name").notNull(),
  contact: text("contact"),
  playerCount: integer("player_count").notNull(),
  status: text("status").notNull().default("pending"),
  notes: text("notes"),
  reservationType: text("reservation_type").notNull().default("court"),
  paymentMethod: text("payment_method").notNull().default("unpaid"),
  paymentStatus: text("payment_status").notNull().default("unpaid"),
  totalFeeCentavos: integer("total_fee_centavos").notNull().default(0),
  paidAmountCentavos: integer("paid_amount_centavos").notNull().default(0),
  source: text("source").notNull().default("manual"),
  externalId: text("external_id"),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
}, (table) => [
  index("reservations_starts_at_idx").on(table.startsAt),
  index("reservations_status_idx").on(table.status),
  index("reservations_court_idx").on(table.courtId),
  index("reservations_player_idx").on(table.customerPlayerId),
  index("reservations_payment_idx").on(table.paymentStatus),
  uniqueIndex("reservations_source_external_unique").on(table.source, table.externalId),
]);

export const reservationPlayers = sqliteTable("reservation_players", {
  reservationId: text("reservation_id").notNull(),
  playerId: text("player_id").notNull(),
}, (table) => [
  uniqueIndex("reservation_players_unique").on(table.reservationId, table.playerId),
  index("reservation_players_player_idx").on(table.playerId),
]);

export const activeGames = sqliteTable("active_games", {
  id: text("id").primaryKey(),
  courtId: integer("court_id").notNull(),
  reservationId: text("reservation_id"),
  shuttlecockId: text("shuttlecock_id").notNull(),
  shuttlecockName: text("shuttlecock_name").notNull(),
  shuttlecockPriceCentavos: integer("shuttlecock_price_centavos").notNull(),
  startedAt: integer("started_at").notNull(),
  createdAt: integer("created_at").notNull(),
  queueOrder: text("queue_order").notNull().default("[]"),
  managedBy: text("managed_by"),
}, (table) => [
  uniqueIndex("active_games_court_unique").on(table.courtId),
  uniqueIndex("active_games_reservation_unique").on(table.reservationId),
]);

export const activeGamePlayers = sqliteTable("active_game_players", {
  gameId: text("game_id").notNull(),
  playerId: text("player_id").notNull(),
  playerName: text("player_name").notNull(),
  playerLevel: text("player_level").notNull().default("C"),
  playerGender: text("player_gender").notNull().default("unspecified"),
}, (table) => [
  uniqueIndex("active_game_players_unique").on(table.gameId, table.playerId),
]);

export const matchPlayers = sqliteTable("match_players", {
  matchId: text("match_id").notNull(),
  playerId: text("player_id").notNull(),
  playerName: text("player_name").notNull(),
  playerLevel: text("player_level").notNull().default("C"),
  playerGender: text("player_gender").notNull().default("unspecified"),
  winner: integer("winner", { mode: "boolean" }).notNull().default(false),
  costCentavos: integer("cost_centavos").notNull(),
}, (table) => [
  uniqueIndex("match_players_unique").on(table.matchId, table.playerId),
  index("match_players_player_idx").on(table.playerId),
  index("match_players_match_idx").on(table.matchId),
]);

export const queueEntries = sqliteTable("queue_entries", {
  id: text("id").primaryKey(),
  playerId: text("player_id").notNull(),
  playerName: text("player_name").notNull(),
  playerLevel: text("player_level").notNull().default("C"),
  playerGender: text("player_gender").notNull().default("unspecified"),
  joinedAt: integer("joined_at").notNull(),
  status: text("status").notNull().default("waiting"),
  standbyTableNumber: integer("standby_table_number"),
  reservationId: text("reservation_id"),
  notes: text("notes"),
  updatedAt: integer("updated_at").notNull(),
}, (table) => [
  index("queue_entries_status_joined_idx").on(table.status, table.joinedAt),
  index("queue_entries_player_idx").on(table.playerId),
]);

export const activityLogs = sqliteTable("activity_logs", {
  id: text("id").primaryKey(),
  type: text("type").notNull(),
  playerId: text("player_id"),
  playerName: text("player_name"),
  courtId: integer("court_id"),
  gameId: text("game_id"),
  reservationId: text("reservation_id"),
  details: text("details").notNull().default("{}"),
  managedBy: text("managed_by"),
  createdAt: integer("created_at").notNull(),
}, (table) => [
  index("activity_logs_created_idx").on(table.createdAt),
  index("activity_logs_player_idx").on(table.playerId),
  index("activity_logs_game_idx").on(table.gameId),
]);

export const gameBillings = sqliteTable("game_billings", {
  gameId: text("game_id").notNull(),
  playerId: text("player_id").notNull(),
  playerName: text("player_name").notNull(),
  betAmountCentavos: integer("bet_amount_centavos").notNull().default(0),
  shuttlecockContributionCentavos: integer("shuttlecock_contribution_centavos").notNull().default(0),
  shuttlecockPayer: integer("shuttlecock_payer", { mode: "boolean" }).notNull().default(false),
  additionalCharges: text("additional_charges").notNull().default("[]"),
  additionalTotalCentavos: integer("additional_total_centavos").notNull().default(0),
  totalDueCentavos: integer("total_due_centavos").notNull().default(0),
  paymentStatus: text("payment_status").notNull().default("unpaid"),
  winner: integer("winner", { mode: "boolean" }).notNull().default(false),
  notes: text("notes"),
  status: text("status").notNull().default("active"),
  updatedAt: integer("updated_at").notNull(),
}, (table) => [
  uniqueIndex("game_billings_game_player_unique").on(table.gameId, table.playerId),
  index("game_billings_player_idx").on(table.playerId),
  index("game_billings_status_idx").on(table.status),
]);

export const playerPayments = sqliteTable("player_payments", {
  id: text("id").primaryKey(),
  playerId: text("player_id").notNull(),
  amountCentavos: integer("amount_centavos").notNull(),
  method: text("method").notNull().default("cash"),
  notes: text("notes"),
  addedBy: text("added_by"),
  createdAt: integer("created_at").notNull(),
}, (table) => [
  index("player_payments_player_created_idx").on(table.playerId, table.createdAt),
]);

export const playerCharges = sqliteTable("player_charges", {
  id: text("id").primaryKey(),
  playerId: text("player_id").notNull(),
  type: text("type").notNull(),
  description: text("description").notNull(),
  amountCentavos: integer("amount_centavos").notNull(),
  addedBy: text("added_by"),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
}, (table) => [
  index("player_charges_player_created_idx").on(table.playerId, table.createdAt),
]);
