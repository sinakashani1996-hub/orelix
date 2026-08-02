import { env } from "cloudflare:workers";
import { drizzle } from "drizzle-orm/d1";
import * as schema from "./schema";

export function getDb() {
  if (!env.DB) {
    throw new Error(
      "Cloudflare D1 binding `DB` is unavailable. Set the `d1` field in .openai/hosting.json to `DB` or let your control plane inject the real binding values before using the database."
    );
  }

  return drizzle(env.DB, { schema });
}

export async function ensureDatabase() {
  if (!env.DB) {
    throw new Error("Cloudflare D1 binding `DB` is unavailable.");
  }

  await env.DB.batch([
    env.DB.prepare(`
      CREATE TABLE IF NOT EXISTS organizations (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        slug TEXT NOT NULL UNIQUE,
        auth_provider_organization_id TEXT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `),
    env.DB.prepare(`
      CREATE TABLE IF NOT EXISTS members (
        id TEXT PRIMARY KEY,
        organization_id TEXT NOT NULL,
        auth_user_id TEXT NOT NULL,
        email TEXT NOT NULL,
        name TEXT NOT NULL,
        role TEXT NOT NULL DEFAULT 'member',
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `),
    env.DB.prepare(`
      CREATE TABLE IF NOT EXISTS modules (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'inactive',
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `),
    env.DB.prepare(`
      CREATE TABLE IF NOT EXISTS work_items (
        id TEXT PRIMARY KEY,
        organization_id TEXT NOT NULL DEFAULT 'org_demo',
        module_id TEXT NOT NULL,
        customer_name TEXT NOT NULL,
        customer_email TEXT NOT NULL,
        title TEXT NOT NULL,
        summary TEXT NOT NULL,
        status TEXT NOT NULL,
        priority TEXT NOT NULL DEFAULT 'normal',
        confidence INTEGER NOT NULL DEFAULT 90,
        received_at TEXT NOT NULL,
        due_label TEXT NOT NULL,
        draft TEXT NOT NULL DEFAULT '',
        provider_message_id TEXT,
        provider_thread_id TEXT,
        source_subject TEXT,
        source_body TEXT NOT NULL DEFAULT '',
        kind TEXT NOT NULL DEFAULT 'quote_request',
        conversation_json TEXT NOT NULL DEFAULT '[]',
        extracted_json TEXT NOT NULL DEFAULT '{}',
        quote_json TEXT NOT NULL DEFAULT '{}',
        ai_provider TEXT NOT NULL DEFAULT 'rules',
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `),
    env.DB.prepare(`
      CREATE TABLE IF NOT EXISTS audit_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        organization_id TEXT NOT NULL DEFAULT 'org_demo',
        work_item_id TEXT NOT NULL,
        actor TEXT NOT NULL,
        action TEXT NOT NULL,
        details TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `),
    env.DB.prepare(`
      CREATE TABLE IF NOT EXISTS organization_modules (
        id TEXT PRIMARY KEY,
        organization_id TEXT NOT NULL,
        module_id TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'inactive',
        settings_json TEXT NOT NULL DEFAULT '{}',
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `),
    env.DB.prepare(`
      CREATE TABLE IF NOT EXISTS integrations (
        id TEXT PRIMARY KEY,
        organization_id TEXT NOT NULL,
        provider TEXT NOT NULL,
        account_email TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'connected',
        encrypted_refresh_token TEXT NOT NULL,
        scopes TEXT NOT NULL,
        history_id TEXT,
        watch_expiration TEXT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `),
    env.DB.prepare(`
      CREATE TABLE IF NOT EXISTS oauth_states (
        state TEXT PRIMARY KEY,
        organization_id TEXT NOT NULL,
        auth_user_id TEXT NOT NULL,
        provider TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `),
    env.DB.prepare(`
      CREATE TABLE IF NOT EXISTS processed_messages (
        id TEXT PRIMARY KEY,
        organization_id TEXT NOT NULL,
        integration_id TEXT NOT NULL,
        provider_message_id TEXT NOT NULL,
        processed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `),
    env.DB.prepare(
      "CREATE INDEX IF NOT EXISTS work_items_status_idx ON work_items(status, received_at)",
    ),
    env.DB.prepare(
      "CREATE INDEX IF NOT EXISTS audit_events_item_idx ON audit_events(work_item_id, created_at)",
    ),
    env.DB.prepare(
      "CREATE UNIQUE INDEX IF NOT EXISTS members_org_user_idx ON members(organization_id, auth_user_id)",
    ),
    env.DB.prepare(
      "CREATE UNIQUE INDEX IF NOT EXISTS organization_modules_org_module_idx ON organization_modules(organization_id, module_id)",
    ),
    env.DB.prepare(
      "CREATE UNIQUE INDEX IF NOT EXISTS integrations_org_provider_idx ON integrations(organization_id, provider)",
    ),
    env.DB.prepare(
      "CREATE UNIQUE INDEX IF NOT EXISTS integrations_provider_account_idx ON integrations(provider, account_email)",
    ),
    env.DB.prepare(
      "CREATE UNIQUE INDEX IF NOT EXISTS processed_messages_provider_idx ON processed_messages(integration_id, provider_message_id)",
    ),
    env.DB.prepare(
      "UPDATE work_items SET draft = replace(draft, CAST(X'546563686E6F6C6F676963204256' AS TEXT), 'First Client BV') WHERE instr(draft, CAST(X'546563686E6F6C6F676963204256' AS TEXT)) > 0",
    ),
  ]);

  const workItemColumns = await env.DB.prepare(
    "PRAGMA table_info(work_items)",
  ).all<{ name: string }>();
  if (
    !workItemColumns.results.some((column) => column.name === "source_body")
  ) {
    await env.DB.prepare(
      "ALTER TABLE work_items ADD COLUMN source_body TEXT NOT NULL DEFAULT ''",
    ).run();
  }
  const additiveColumns = [
    ["conversation_json", "TEXT NOT NULL DEFAULT '[]'"],
    ["extracted_json", "TEXT NOT NULL DEFAULT '{}'"],
    ["quote_json", "TEXT NOT NULL DEFAULT '{}'"],
    ["ai_provider", "TEXT NOT NULL DEFAULT 'rules'"],
  ] as const;
  for (const [name, definition] of additiveColumns) {
    if (workItemColumns.results.some((column) => column.name === name)) continue;
    await env.DB.prepare(
      `ALTER TABLE work_items ADD COLUMN ${name} ${definition}`,
    ).run();
  }
}
