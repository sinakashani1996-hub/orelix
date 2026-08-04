import { sql } from "drizzle-orm";
import { integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const organizations = sqliteTable("organizations", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  authProviderOrganizationId: text("auth_provider_organization_id"),
  companyAddress: text("company_address").notNull().default(""),
  companyVatNumber: text("company_vat_number").notNull().default(""),
  companyEmail: text("company_email").notNull().default(""),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const members = sqliteTable(
  "members",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id").notNull(),
    authUserId: text("auth_user_id").notNull(),
    email: text("email").notNull(),
    name: text("name").notNull(),
    role: text("role").notNull().default("member"),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    uniqueIndex("members_org_user_idx").on(
      table.organizationId,
      table.authUserId,
    ),
  ],
);

export const modules = sqliteTable("modules", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description").notNull(),
  status: text("status").notNull().default("inactive"),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const workItems = sqliteTable("work_items", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id").notNull().default("org_demo"),
  moduleId: text("module_id").notNull(),
  customerName: text("customer_name").notNull(),
  customerEmail: text("customer_email").notNull(),
  title: text("title").notNull(),
  summary: text("summary").notNull(),
  status: text("status").notNull(),
  priority: text("priority").notNull().default("normal"),
  confidence: integer("confidence").notNull().default(90),
  receivedAt: text("received_at").notNull(),
  dueLabel: text("due_label").notNull(),
  draft: text("draft").notNull().default(""),
  providerMessageId: text("provider_message_id"),
  providerThreadId: text("provider_thread_id"),
  mailboxIntegrationId: text("mailbox_integration_id"),
  sourceSubject: text("source_subject"),
  sourceBody: text("source_body").notNull().default(""),
  kind: text("kind").notNull().default("quote_request"),
  conversationJson: text("conversation_json").notNull().default("[]"),
  extractedJson: text("extracted_json").notNull().default("{}"),
  quoteJson: text("quote_json").notNull().default("{}"),
  aiProvider: text("ai_provider").notNull().default("rules"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const auditEvents = sqliteTable("audit_events", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  organizationId: text("organization_id").notNull().default("org_demo"),
  workItemId: text("work_item_id").notNull(),
  actor: text("actor").notNull(),
  action: text("action").notNull(),
  details: text("details").notNull().default(""),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const quoteSignatures = sqliteTable(
  "quote_signatures",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id").notNull(),
    workItemId: text("work_item_id").notNull(),
    tokenHash: text("token_hash").notNull(),
    quoteSnapshotJson: text("quote_snapshot_json").notNull(),
    quoteHash: text("quote_hash").notNull(),
    customerName: text("customer_name").notNull(),
    customerEmail: text("customer_email").notNull(),
    status: text("status").notNull().default("pending"),
    expiresAt: text("expires_at").notNull(),
    sentAt: text("sent_at").notNull(),
    viewedAt: text("viewed_at"),
    signerName: text("signer_name"),
    signatureDataUrl: text("signature_data_url"),
    acceptedAt: text("accepted_at"),
    acceptedIp: text("accepted_ip"),
    acceptedUserAgent: text("accepted_user_agent"),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    uniqueIndex("quote_signatures_token_idx").on(table.tokenHash),
  ],
);

export const organizationModules = sqliteTable(
  "organization_modules",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id").notNull(),
    moduleId: text("module_id").notNull(),
    status: text("status").notNull().default("inactive"),
    settingsJson: text("settings_json").notNull().default("{}"),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    uniqueIndex("organization_modules_org_module_idx").on(
      table.organizationId,
      table.moduleId,
    ),
  ],
);

export const integrations = sqliteTable(
  "integrations",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id").notNull(),
    provider: text("provider").notNull(),
    accountEmail: text("account_email").notNull(),
    status: text("status").notNull().default("connected"),
    encryptedRefreshToken: text("encrypted_refresh_token").notNull(),
    encryptedCredentials: text("encrypted_credentials").notNull().default(""),
    scopes: text("scopes").notNull(),
    historyId: text("history_id"),
    watchExpiration: text("watch_expiration"),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    uniqueIndex("integrations_org_provider_idx").on(
      table.organizationId,
      table.provider,
    ),
    uniqueIndex("integrations_provider_account_idx").on(
      table.provider,
      table.accountEmail,
    ),
  ],
);

export const oauthStates = sqliteTable("oauth_states", {
  state: text("state").primaryKey(),
  organizationId: text("organization_id").notNull(),
  authUserId: text("auth_user_id").notNull(),
  provider: text("provider").notNull(),
  expiresAt: text("expires_at").notNull(),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const processedMessages = sqliteTable(
  "processed_messages",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id").notNull(),
    integrationId: text("integration_id").notNull(),
    providerMessageId: text("provider_message_id").notNull(),
    processedAt: text("processed_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    uniqueIndex("processed_messages_provider_idx").on(
      table.integrationId,
      table.providerMessageId,
    ),
  ],
);
