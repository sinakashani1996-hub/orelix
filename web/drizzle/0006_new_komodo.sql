ALTER TABLE `work_items` ADD `conversation_json` text DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE `work_items` ADD `extracted_json` text DEFAULT '{}' NOT NULL;--> statement-breakpoint
ALTER TABLE `work_items` ADD `quote_json` text DEFAULT '{}' NOT NULL;--> statement-breakpoint
ALTER TABLE `work_items` ADD `ai_provider` text DEFAULT 'rules' NOT NULL;