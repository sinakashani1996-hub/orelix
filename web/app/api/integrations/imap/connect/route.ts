import { and, eq } from "drizzle-orm";
import { getDb } from "../../../../../db";
import { integrations } from "../../../../../db/schema";
import { getAppContext } from "../../../../../lib/context";
import { encryptMailboxCredentials } from "../../../../../lib/mail-credentials";
import { parseImapMailboxSettings, verifyImapMailbox } from "../../../../../lib/imap";
import { syncImapMailbox } from "../../../../../lib/imap-sync";
import { verifySmtpMailbox } from "../../../../../lib/smtp";

/**
 * Connect a standard IMAP/SMTP mailbox (for example an Easyhost address).
 * Credentials are verified first, then immediately encrypted at rest. They are
 * never returned by this route.
 */
export async function POST(request: Request) {
  const context = await getAppContext();
  if (!context?.organization) {
    return Response.json({ error: "Niet aangemeld" }, { status: 401 });
  }

  try {
    const settings = parseImapMailboxSettings(await request.json());
    await verifyImapMailbox(settings);
    await verifySmtpMailbox(settings);

    const db = getDb();
    const now = new Date().toISOString();
    const existing = (
      await db
        .select()
        .from(integrations)
        .where(
          and(
            eq(integrations.organizationId, context.organization.id),
            eq(integrations.provider, "imap_smtp"),
          ),
        )
        .limit(1)
    )[0];

    const storedCredentials = await encryptMailboxCredentials({
      email: settings.email,
      password: settings.password,
      imapHost: settings.imapHost,
      imapPort: settings.imapPort,
      smtpHost: settings.smtpHost,
      smtpPort: settings.smtpPort,
    });
    const values = {
      accountEmail: settings.email,
      status: "connected",
      encryptedRefreshToken: existing?.encryptedRefreshToken || "",
      encryptedCredentials: storedCredentials,
      scopes: "imap smtp",
      historyId: null,
      watchExpiration: null,
      updatedAt: now,
    };

    let integration;
    if (existing) {
      integration = (
        await db
          .update(integrations)
          .set(values)
          .where(eq(integrations.id, existing.id))
          .returning()
      )[0];
    } else {
      integration = (
        await db
          .insert(integrations)
          .values({
        id: `integration_${crypto.randomUUID()}`,
        organizationId: context.organization.id,
        provider: "imap_smtp",
        ...values,
          })
          .returning()
      )[0];
    }

    // Importing older messages is useful, but must never turn a successfully
    // verified connection into a reported failure. Providers may briefly rate
    // limit the second login or a single older message can be malformed. The
    // customer can still use the explicit Sync action afterwards.
    let synced = { processed: 0 };
    let syncWarning: string | undefined;
    try {
      synced = await syncImapMailbox(integration);
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : "Unknown IMAP sync error";
      console.error(
        JSON.stringify({
          event: "imap_initial_sync_failed_after_connect",
          organizationId: context.organization.id,
          integrationId: integration.id,
          error: message,
        }),
      );
      syncWarning =
        "De mailbox is gekoppeld, maar recente berichten konden nog niet worden geïmporteerd. Gebruik straks het synchronisatie-icoon om opnieuw te proberen.";
    }

    return Response.json({
      ok: true,
      provider: "imap_smtp",
      accountEmail: settings.email,
      status: "connected",
      ...synced,
      syncWarning,
    });
  } catch (caught) {
    const rawMessage = caught instanceof Error ? caught.message : "Mailbox koppelen is niet gelukt";
    const message = /UNIQUE constraint failed: integrations\.provider, integrations\.account_email/i.test(rawMessage)
      ? "Deze mailbox is al aan een andere Orelix-workspace gekoppeld. Ontkoppel hem daar eerst."
      : rawMessage;
    console.error(JSON.stringify({ event: "imap_connection_failed", organizationId: context.organization.id, error: message }));
    return Response.json({ error: message }, { status: 400 });
  }
}
