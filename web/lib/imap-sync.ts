import { eq } from "drizzle-orm";
import { getDb } from "../db";
import { integrations } from "../db/schema";
import { fetchRecentImapMessages, parseImapMailboxSettings } from "./imap";
import { ingestIncomingMailboxMessage } from "./mail-ingestion";
import { decryptMailboxCredentials } from "./mail-credentials";

type Integration = typeof integrations.$inferSelect;

/**
 * Pulls new IMAP messages after the stored UID cursor. The first connection
 * imports a bounded recent window; later manual syncs are intentionally fast
 * and do not re-download the same mailbox history.
 */
export async function syncImapMailbox(integration: Integration) {
  if (!integration.encryptedCredentials) {
    throw new Error("De mailboxgegevens ontbreken. Koppel de mailbox opnieuw.");
  }
  const credentials = await decryptMailboxCredentials<Record<string, unknown>>(
    integration.encryptedCredentials,
  );
  const settings = parseImapMailboxSettings(credentials);
  const messages = await fetchRecentImapMessages(
    settings,
    undefined,
    integration.historyId,
  );
  let processed = 0;
  for (const message of messages) {
    processed += await ingestIncomingMailboxMessage(integration, message);
  }
  await getDb()
    .update(integrations)
    .set({
      status: "connected",
      historyId: messages.at(-1)?.uid || integration.historyId,
      updatedAt: new Date().toISOString(),
    })
    .where(eq(integrations.id, integration.id));
  return { processed, checked: messages.length };
}
