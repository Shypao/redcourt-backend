ALTER TABLE `game_billings` ADD `shuttlecock_payer` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `players` ADD `normalized_name` text;--> statement-breakpoint
CREATE UNIQUE INDEX `players_normalized_name_unique` ON `players` (`normalized_name`);