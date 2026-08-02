import { getDb } from "../../../../db";
import { integrations } from "../../../../db/schema";
import { eq } from "drizzle-orm";
import { getAppContext } from "../../../../lib/context";
import {
  accessTokenFor,
  getGmailProfile,
  processGmailNotification,
  recoverRecentMessages,
} from "../../../../lib/gmail";

// Manually triggers Gmail ingestion for the current workspace. Used by the
// "Postvak synchroniseren" button when a push is missed or arrives late, so a
// customer reply surfaces without waiting for the next Pub/Sub notification.
// ?force=true scans the most recent messages directly, ignoring the history
// cursor. This is safe to rerun because processed_messages dedup is enforced
// inside the Gmail layer.
export async function POST(request: Request) {
  const context = await getAppContext();
  if (!context?.organization) {
    return Response.json({ error: "Niet aangemeld" }, { status: 401 });
  }

  const db = getDb();
  const integration = (
    await db
      .select()
      .from(integrations)
      .where(eq(integrations.organizationId, context.organization.id))
      .limit(1)
  )[0];
  if (!integration) {
    return Response.json(
      { error: "Koppel eerst Gmail voordat je het postvak synchroniseert." },
      { status: 409 },
    );
  }

  try {
    const force =
      new URL(request.url).searchParams.get("force") === "true";
    let processed: number;
    let historyId: string | null;
    if (force || !integration.historyId) {
      const accessToken = await accessTokenFor(integration);
      processed = await recoverRecentMessages(integration, accessToken);
      historyId = await getGmailProfile(accessToken)
        .then((profile) => profile.historyId.toString())
        .catch(() => null);
    } else {
      // Re-process using the live mailbox history id so any gap since the last
      // push is closed. processGmailNotification handles the stored cursor.
      const accessToken = await accessTokenFor(integration);
      const profile = await getGmailProfile(accessToken);
      processed = await processGmailNotification(
        integration,
        profile.historyId.toString(),
      );
      historyId = profile.historyId.toString();
    }

    return Response.json({ ok: true, processed, historyId });
  } catch (caught) {
    const message =
      caught instanceof Error
        ? caught.message
        : "Unknown Gmail sync error";
    console.error(
      JSON.stringify({
        event: "gmail_sync_failed",
        organizationId: context.organization.id,
        error: message,
      }),
    );
    return Response.json(
      { error: "Synchroniseren van het postvak is niet gelukt." },
      { status: 500 },
    );
  }
}
