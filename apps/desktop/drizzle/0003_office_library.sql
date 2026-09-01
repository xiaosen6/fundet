CREATE TABLE `office_library` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`kind` text NOT NULL,
	`source_path` text NOT NULL,
	`placeholders` text NOT NULL,
	`excerpt` text NOT NULL,
	`created_at` integer NOT NULL
);
