import { and, eq } from "drizzle-orm";
import { getDb } from "../../../../../db";
import { integrations } from "../../../../../db/schema";
import { getAppContext } from "../../../../../lib/context";
import { encryptMailboxCredentials } from "../../../../../lib/mail-credentials";
import { parseImapMailboxSettings, verifyImapMailbox } from "../../../../../lib/imap";
import { syncImapMailbox } from "../../../../../lib/imap-sync";

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
      status: "configured",
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

    // Import the bounded recent mailbox window now. This lets the customer see
    // existing unanswered mail immediately and proves the full receive path.
    const synced = await syncImapMailbox(integration);

    return Response.json({
      ok: true,
      provider: "imap_smtp",
      accountEmail: settings.email,
      status: "connected",
      ...synced,
    });
  } catch (caught) {
    const message = caught instanceof Error ? caught.message : "Mailbox koppelen is niet gelukt";
    console.error(JSON.stringify({ event: "imap_connection_failed", organizationId: context.organization.id, error: message }));
    return Response.json({ error: message }, { status: 400 });
  }
}
