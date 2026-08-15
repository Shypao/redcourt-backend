CREATE TABLE IF NOT EXISTS `matches` (
	`id` text PRIMARY KEY NOT NULL,
	`court_id` integer NOT NULL,
	`player_names` text NOT NULL,
	`started_at` integer NOT NULL,
	`ended_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `players` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`times_played` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
ALTER TABLE `players` ADD `total_bill_centavos` integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE `matches` ADD `shuttlecock_name` text DEFAULT 'Unknown' NOT NULL;
--> statement-breakpoint
ALTER TABLE `matches` ADD `shuttlecock_price_centavos` integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE `matches` ADD `cost_per_player_centavos` integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE `matches` ADD `player_costs` text DEFAULT '[]' NOT NULL;
