CREATE TABLE `player_charges` (
	`id` text PRIMARY KEY NOT NULL,
	`player_id` text NOT NULL,
	`type` text NOT NULL,
	`description` text NOT NULL,
	`amount_centavos` integer NOT NULL,
	`added_by` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `player_charges_player_created_idx` ON `player_charges` (`player_id`,`created_at`);--> statement-breakpoint
ALTER TABLE `active_game_players` ADD `player_gender` text DEFAULT 'unspecified' NOT NULL;--> statement-breakpoint
ALTER TABLE `match_players` ADD `player_gender` text DEFAULT 'unspecified' NOT NULL;--> statement-breakpoint
ALTER TABLE `match_players` ADD `winner` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `matches` ADD `match_notes` text;--> statement-breakpoint
ALTER TABLE `player_payments` ADD `added_by` text;