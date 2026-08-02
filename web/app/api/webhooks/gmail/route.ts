import { eq } from "drizzle-orm";
import { createRemoteJWKSet, jwtVerify } from "jose";
import { ensureDatabase, getDb } from "../../../../db";
import { integrations } from "../../../../db/schema";
import { gmailConfig, processGmailNotification } from "../../../../lib/gmail";

export async function POST(request: Request) {
  const config = gmailConfig();
  if (!config || !(await verifyPubSubRequest(request, config))) {
    return Response.json({ error: "Unauthorized webhook" }, { status: 401 });
  }

  const payload = (await request.json()) as {
    message?: { data?: string; messageId?: string };
  };
  if (!payload.message?.data) {
    return Response.json({ ok: true, processed: 0 });
  }

  const notification = JSON.parse(
    new TextDecoder().decode(fromBase64(payload.message.data)),
  ) as { emailAddress?: string; historyId?: string };
  if (!notification.emailAddress || !notification.historyId) {
    return Response.json({ ok: true, processed: 0 });
  }

  await ensureDatabase();
  const integration = (
    await getDb()
      .select()
      .from(integrations)
      .where(eq(integrations.accountEmail, notification.emailAddress))
      .limit(1)
  )[0];
  if (!integration) {
    return Response.json({ ok: true, processed: 0 });
  }

  try {
    const processed = await processGmailNotification(
      integration,
      notification.historyId,
    );
    console.log(
      JSON.stringify({
        event: "gmail_notification_processed",
        messageId: payload.message.messageId || null,
        processed,
      }),
    );
    return Response.json({ ok: true, processed });
  } catch (caught) {
    const message =
      caught instanceof Error ? caught.message : "Unknown Gmail webhook error";
    console.error(
      JSON.stringify({
        event: "gmail_notification_failed",
        messageId: payload.message.messageId || null,
        error: message,
      }),
    );
    return Response.json(
      { error: "Gmail notification processing failed" },
      { status: 500 },
    );
  }
}

async function verifyPubSubRequest(
  request: Request,
  config: NonNullable<ReturnType<typeof gmailConfig>>,
) {
  if (config.pubsubAudience && config.pubsubServiceAccountEmail) {
    const bearer = request.headers.get("authorization")?.match(/^Bearer (.+)$/i)?.[1];
    if (!bearer) return false;
    try {
      const jwks = createRemoteJWKSet(
        new URL("https://www.googleapis.com/oauth2/v3/certs"),
      );
      const { payload } = await jwtVerify(bearer, jwks, {
        audience: config.pubsubAudience,
        issuer: ["https://accounts.google.com", "accounts.google.com"],
      });
      return (
        payload.email === config.pubsubServiceAccountEmail &&
        payload.email_verified === true
      );
    } catch {
      return false;
    }
  }

  return Boolean(
    config.webhookSecret &&
      new URL(request.url).searchParams.get("token") === config.webhookSecret,
  );
}

function fromBase64(value: string) {
  const binary = atob(value);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}
