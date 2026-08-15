ALTER TABLE `reservations` ADD `reservation_type` text DEFAULT 'court' NOT NULL;--> statement-breakpoint
ALTER TABLE `reservations` ADD `payment_method` text DEFAULT 'unpaid' NOT NULL;--> statement-breakpoint
ALTER TABLE `reservations` ADD `payment_status` text DEFAULT 'unpaid' NOT NULL;--> statement-breakpoint
ALTER TABLE `reservations` ADD `total_fee_centavos` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `reservations` ADD `paid_amount_centavos` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `reservations` ADD `source` text DEFAULT 'manual' NOT NULL;--> statement-breakpoint
ALTER TABLE `reservations` ADD `external_id` text;--> statement-breakpoint
CREATE INDEX `reservations_payment_idx` ON `reservations` (`payment_status`);--> statement-breakpoint
CREATE UNIQUE INDEX `reservations_source_external_unique` ON `reservations` (`source`,`external_id`);