CREATE TABLE `office_docs` (
	`id` text PRIMARY KEY NOT NULL,
	`template_id` text NOT NULL,
	`title` text NOT NULL,
	`fields` text NOT NULL,
	`docx_path` text,
	`pdf_path` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `office_trips` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`start_at` integer NOT NULL,
	`end_at` integer NOT NULL,
	`location` text NOT NULL DEFAULT '',
	`kind` text NOT NULL DEFAULT 'other',
	`notes` text NOT NULL DEFAULT '',
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_office_trips_start` ON `office_trips` (`start_at`);
--> statement-breakpoint
CREATE TABLE `office_health_logs` (
	`id` text PRIMARY KEY NOT NULL,
	`logged_at` integer NOT NULL,
	`type` text NOT NULL,
	`payload` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_office_health_logged` ON `office_health_logs` (`logged_at`);
