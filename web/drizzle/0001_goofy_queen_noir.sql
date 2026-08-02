CREATE TABLE `integrations` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`provider` text NOT NULL,
	`account_email` text NOT NULL,
	`status` text DEFAULT 'connected' NOT NULL,
	`encrypted_refresh_token` text NOT NULL,
	`scopes` text NOT NULL,
	`history_id` text,
	`watch_expiration` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `integrations_org_provider_idx` ON `integrations` (`organization_id`,`provider`);--> statement-breakpoint
CREATE TABLE `members` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`auth_user_id` text NOT NULL,
	`email` text NOT NULL,
	`name` text NOT NULL,
	`role` text DEFAULT 'member' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `members_org_user_idx` ON `members` (`organization_id`,`auth_user_id`);--> statement-breakpoint
CREATE TABLE `oauth_states` (
	`state` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`auth_user_id` text NOT NULL,
	`provider` text NOT NULL,
	`expires_at` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE `organization_modules` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`module_id` text NOT NULL,
	`status` text DEFAULT 'inactive' NOT NULL,
	`settings_json` text DEFAULT '{}' NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `organization_modules_org_module_idx` ON `organization_modules` (`organization_id`,`module_id`);--> statement-breakpoint
CREATE TABLE `organizations` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`slug` text NOT NULL,
	`auth_provider_organization_id` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `organizations_slug_unique` ON `organizations` (`slug`);--> statement-breakpoint
CREATE TABLE `processed_messages` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`integration_id` text NOT NULL,
	`provider_message_id` text NOT NULL,
	`processed_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `processed_messages_provider_idx` ON `processed_messages` (`integration_id`,`provider_message_id`);--> statement-breakpoint
ALTER TABLE `audit_events` ADD `organization_id` text DEFAULT 'org_demo' NOT NULL;--> statement-breakpoint
ALTER TABLE `work_items` ADD `organization_id` text DEFAULT 'org_demo' NOT NULL;--> statement-breakpoint
ALTER TABLE `work_items` ADD `provider_message_id` text;--> statement-breakpoint
ALTER TABLE `work_items` ADD `provider_thread_id` text;--> statement-breakpoint
ALTER TABLE `work_items` ADD `source_subject` text;--> statement-breakpoint
ALTER TABLE `work_items` ADD `kind` text DEFAULT 'quote_request' NOT NULL;