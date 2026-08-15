CREATE TABLE `activity_logs` (
	`id` text PRIMARY KEY NOT NULL,
	`type` text NOT NULL,
	`player_id` text,
	`player_name` text,
	`court_id` integer,
	`game_id` text,
	`reservation_id` text,
	`details` text DEFAULT '{}' NOT NULL,
	`managed_by` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `activity_logs_created_idx` ON `activity_logs` (`created_at`);--> statement-breakpoint
CREATE INDEX `activity_logs_player_idx` ON `activity_logs` (`player_id`);--> statement-breakpoint
CREATE INDEX `activity_logs_game_idx` ON `activity_logs` (`game_id`);--> statement-breakpoint
CREATE TABLE `game_billings` (
	`game_id` text NOT NULL,
	`player_id` text NOT NULL,
	`player_name` text NOT NULL,
	`bet_amount_centavos` integer DEFAULT 0 NOT NULL,
	`shuttlecock_contribution_centavos` integer DEFAULT 0 NOT NULL,
	`additional_charges` text DEFAULT '[]' NOT NULL,
	`additional_total_centavos` integer DEFAULT 0 NOT NULL,
	`total_due_centavos` integer DEFAULT 0 NOT NULL,
	`payment_status` text DEFAULT 'unpaid' NOT NULL,
	`winner` integer DEFAULT false NOT NULL,
	`notes` text,
	`status` text DEFAULT 'active' NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `game_billings_game_player_unique` ON `game_billings` (`game_id`,`player_id`);--> statement-breakpoint
CREATE INDEX `game_billings_player_idx` ON `game_billings` (`player_id`);--> statement-breakpoint
CREATE INDEX `game_billings_status_idx` ON `game_billings` (`status`);--> statement-breakpoint
CREATE TABLE `queue_entries` (
	`id` text PRIMARY KEY NOT NULL,
	`player_id` text NOT NULL,
	`player_name` text NOT NULL,
	`player_level` text DEFAULT 'C' NOT NULL,
	`joined_at` integer NOT NULL,
	`status` text DEFAULT 'waiting' NOT NULL,
	`standby_table_number` integer,
	`reservation_id` text,
	`notes` text,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `queue_entries_status_joined_idx` ON `queue_entries` (`status`,`joined_at`);--> statement-breakpoint
CREATE INDEX `queue_entries_player_idx` ON `queue_entries` (`player_id`);--> statement-breakpoint
ALTER TABLE `matches` ADD `billing_total_centavos` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `matches` ADD `billing_summary` text DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE `matches` ADD `substitution_count` integer DEFAULT 0 NOT NULL;