ALTER TABLE `active_game_players` ADD `player_level` text DEFAULT 'C' NOT NULL;--> statement-breakpoint
ALTER TABLE `match_players` ADD `player_level` text DEFAULT 'C' NOT NULL;--> statement-breakpoint
ALTER TABLE `players` ADD `level` text DEFAULT 'C' NOT NULL;