ALTER TABLE `usage_daily` ADD `input_tokens` integer NOT NULL DEFAULT 0;--> statement-breakpoint
ALTER TABLE `usage_daily` ADD `output_tokens` integer NOT NULL DEFAULT 0;--> statement-breakpoint
ALTER TABLE `usage_daily` ADD `cache_read_tokens` integer NOT NULL DEFAULT 0;--> statement-breakpoint
ALTER TABLE `usage_daily` ADD `cache_write_tokens` integer NOT NULL DEFAULT 0;
