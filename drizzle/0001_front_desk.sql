ALTER TABLE `players` ADD `contact` text;
--> statement-breakpoint
ALTER TABLE `players` ADD `updated_at` integer;
--> statement-breakpoint
ALTER TABLE `matches` ADD `reservation_id` text;
--> statement-breakpoint
ALTER TABLE `matches` ADD `status` text DEFAULT 'completed' NOT NULL;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `courts` (`id` integer PRIMARY KEY NOT NULL, `number` integer NOT NULL, `maintenance` integer DEFAULT false NOT NULL, `maintenance_note` text, `updated_at` integer NOT NULL);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `courts_number_unique` ON `courts` (`number`);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `reservations` (`id` text PRIMARY KEY NOT NULL, `starts_at` integer NOT NULL, `ends_at` integer NOT NULL, `court_id` integer, `customer_player_id` text NOT NULL, `customer_name` text NOT NULL, `contact` text, `player_count` integer NOT NULL, `status` text DEFAULT 'pending' NOT NULL, `notes` text, `created_at` integer NOT NULL, `updated_at` integer NOT NULL);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `reservations_starts_at_idx` ON `reservations` (`starts_at`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `reservations_status_idx` ON `reservations` (`status`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `reservations_court_idx` ON `reservations` (`court_id`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `reservations_player_idx` ON `reservations` (`customer_player_id`);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `reservation_players` (`reservation_id` text NOT NULL, `player_id` text NOT NULL);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `reservation_players_unique` ON `reservation_players` (`reservation_id`,`player_id`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `reservation_players_player_idx` ON `reservation_players` (`player_id`);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `active_games` (`id` text PRIMARY KEY NOT NULL, `court_id` integer NOT NULL, `reservation_id` text, `shuttlecock_id` text NOT NULL, `shuttlecock_name` text NOT NULL, `shuttlecock_price_centavos` integer NOT NULL, `started_at` integer NOT NULL, `created_at` integer NOT NULL);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `active_games_court_unique` ON `active_games` (`court_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `active_games_reservation_unique` ON `active_games` (`reservation_id`);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `active_game_players` (`game_id` text NOT NULL, `player_id` text NOT NULL, `player_name` text NOT NULL);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `active_game_players_unique` ON `active_game_players` (`game_id`,`player_id`);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `match_players` (`match_id` text NOT NULL, `player_id` text NOT NULL, `player_name` text NOT NULL, `cost_centavos` integer NOT NULL);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `match_players_unique` ON `match_players` (`match_id`,`player_id`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `match_players_player_idx` ON `match_players` (`player_id`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `match_players_match_idx` ON `match_players` (`match_id`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `matches_ended_at_idx` ON `matches` (`ended_at`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `matches_court_idx` ON `matches` (`court_id`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `matches_shuttlecock_idx` ON `matches` (`shuttlecock_name`);
--> statement-breakpoint
INSERT OR IGNORE INTO `courts` (`id`,`number`,`maintenance`,`updated_at`) VALUES (1,1,0,0),(2,2,0,0),(3,3,0,0),(4,4,0,0),(5,5,0,0),(6,6,0,0),(7,7,0,0),(8,8,0,0),(9,9,0,0);
