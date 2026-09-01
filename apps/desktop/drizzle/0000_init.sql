CREATE TABLE `messages` (
	`id` text PRIMARY KEY NOT NULL,
	`session_id` text NOT NULL,
	`role` text NOT NULL,
	`content` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`session_id`) REFERENCES `sessions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_messages_session` ON `messages` (`session_id`);--> statement-breakpoint
CREATE TABLE `providers` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`api` text NOT NULL,
	`base_url` text NOT NULL,
	`models` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`agent_kind` text DEFAULT 'pi' NOT NULL,
	`title` text DEFAULT '' NOT NULL,
	`work_dir` text NOT NULL,
	`model` text NOT NULL,
	`effort` text,
	`permission_mode` text,
	`status` text DEFAULT 'active' NOT NULL,
	`sdk_session_id` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
