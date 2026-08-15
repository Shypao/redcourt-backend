ALTER TABLE `courts` ADD `name` text;
--> statement-breakpoint
ALTER TABLE `active_games` ADD `queue_order` text DEFAULT '[]' NOT NULL;
--> statement-breakpoint
ALTER TABLE `active_games` ADD `managed_by` text;
--> statement-breakpoint
ALTER TABLE `matches` ADD `court_name` text;
--> statement-breakpoint
ALTER TABLE `matches` ADD `winner_name` text;
--> statement-breakpoint
ALTER TABLE `matches` ADD `queue_order` text DEFAULT '[]' NOT NULL;
--> statement-breakpoint
ALTER TABLE `matches` ADD `managed_by` text;
