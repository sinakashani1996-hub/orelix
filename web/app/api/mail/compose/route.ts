import { and, eq } from "drizzle-orm";
import { ensureDatabase, getDb } from "../../../../db";
import { integrations } from "../../../../db/schema";
import { getAppContext } from "../../../../lib/context";
import {
  integrationForOrganization,
  sendWorkItemEmail,
} from "../../../../lib/gmail";
import { sendSmtpWorkItemEmail } from "../../../../lib/smtp";

export async function POST(request: Request) {
  const context = await getAppContext();
  if (!context?.organization) {
    return Response.json({ error: "Niet aangemeld" }, { status: 401 });
  }

  const payload = (await request.json().catch(() => ({}))) as {
    to?: string;
    subject?: string;
    body?: string;
  };
  const to = payload.to?.trim().toLowerCase() || "";
  const subject = payload.subject?.trim() || "";
  const body = payload.body?.trim() || "";

  if (!/^\S+@\S+\.\S+$/.test(to)) {
    return Response.json(
      { error: "Vul een geldig e-mailadres in" },
      { status: 400 },
    );
  }
  if (!subject) {
    return Response.json({ error: "Het onderwerp mag niet leeg zijn" }, { status: 400 });
  }
  if (!body) {
    return Response.json({ error: "Het bericht mag niet leeg zijn" }, { status: 400 });
  }

  await ensureDatabase();
  const db = getDb();
  const gmail = await integrationForOrganization(context.organization.id);
  const imap = (
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
  const integration = gmail || imap;
  if (!integration) {
    return Response.json(
      { error: "Koppel eerst een mailbox voordat je een bericht verzendt." },
      { status: 409 },
    );
  }

  const outbound = {
    customerEmail: to,
    customerName: to,
    sourceSubject: null,
    providerThreadId: null,
    subjectOverride: subject,
    draft: body,
  };
  try {
    if (integration.provider === "imap_smtp") {
      await sendSmtpWorkItemEmail(integration, outbound);
    } else {
      await sendWorkItemEmail(integration, outbound);
    }
  } catch (caught) {
    return Response.json(
      {
        error:
          caught instanceof Error
            ? `Verzenden mislukt: ${caught.message}`
            : "Verzenden mislukt",
      },
      { status: 502 },
    );
  }

  return Response.json({ sent: true });
}
