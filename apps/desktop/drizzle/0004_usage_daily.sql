CREATE TABLE `usage_daily` (
	`day` text NOT NULL,
	`model` text NOT NULL,
	`tokens` integer NOT NULL,
	`cost_usd` real NOT NULL,
	PRIMARY KEY (`day`, `model`)
);
