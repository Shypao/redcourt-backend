CREATE TABLE `player_payments` (
	`id` text PRIMARY KEY NOT NULL,
	`player_id` text NOT NULL,
	`amount_centavos` integer NOT NULL,
	`method` text DEFAULT 'cash' NOT NULL,
	`notes` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `player_payments_player_created_idx` ON `player_payments` (`player_id`,`created_at`);--> statement-breakpoint
ALTER TABLE `queue_entries` ADD `player_gender` text DEFAULT 'unspecified' NOT NULL;--> statement-breakpoint
ALTER TABLE `players` ADD `gender` text DEFAULT 'unspecified' NOT NULL;--> statement-breakpoint
ALTER TABLE `players` ADD `notes` text;
