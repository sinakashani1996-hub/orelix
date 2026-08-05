import { and, desc, eq } from "drizzle-orm";
import { ensureDatabase, getDb } from "../../../../../db";
import {
  auditEvents,
  integrations,
  quoteSignatures,
  workItems,
} from "../../../../../db/schema";
import { getAppContext } from "../../../../../lib/context";
import {
  integrationForOrganization,
  sendWorkItemEmail,
} from "../../../../../lib/gmail";
import { sendSmtpWorkItemEmail } from "../../../../../lib/smtp";
import { normalizeQuoteBuilder } from "../../../../../lib/quote-builder";
import { appUrl } from "../../../../../lib/app-url";
import {
  createSigningToken,
  hashQuoteSnapshot,
  hashSigningToken,
} from "../../../../../lib/quote-signing";

const MAX_LABEL_LENGTH = 40;

type QuoteAction = "reminder" | "label" | "mark_signed" | "cancel";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const context = await getAppContext();
  if (!context?.organization) {
    return Response.json({ error: "Niet aangemeld" }, { status: 401 });
  }
  const { id } = await params;
  const payload = (await request.json().catch(() => ({}))) as {
    action?: QuoteAction;
    label?: unknown;
  };
  if (!payload.action || !["reminder", "label", "mark_signed", "cancel"].includes(payload.action)) {
    return Response.json({ error: "Onbekende actie" }, { status: 400 });
  }

  await ensureDatabase();
  const db = getDb();
  const [item] = await db
    .select()
    .from(workItems)
    .where(
      and(
        eq(workItems.id, id),
        eq(workItems.organizationId, context.organization.id),
      ),
    )
    .limit(1);
  if (!item) {
    return Response.json({ error: "Dossier niet gevonden" }, { status: 404 });
  }

  const now = new Date().toISOString();

  if (payload.action === "label") {
    const label =
      typeof payload.label === "string"
        ? payload.label.trim().slice(0, MAX_LABEL_LENGTH)
        : "";
    const [updated] = await db
      .update(workItems)
      .set({ label, updatedAt: now })
      .where(eq(workItems.id, item.id))
      .returning();
    await db.insert(auditEvents).values({
      organizationId: context.organization.id,
      workItemId: item.id,
      actor: context.user.email,
      action: "label_changed",
      details: label ? `Label ingesteld op "${label}"` : "Label verwijderd",
    });
    return Response.json({ item: updated });
  }

  // The remaining actions operate on the open signing request of this dossier.
  const [signing] = await db
    .select()
    .from(quoteSignatures)
    .where(
      and(
        eq(quoteSignatures.organizationId, context.organization.id),
        eq(quoteSignatures.workItemId, item.id),
        eq(quoteSignatures.status, "pending"),
      ),
    )
    .orderBy(desc(quoteSignatures.sentAt))
    .limit(1);
  if (!signing) {
    return Response.json(
      { error: "Er is geen openstaande offerte om te bewerken." },
      { status: 409 },
    );
  }

  if (payload.action === "mark_signed") {
    await db
      .update(quoteSignatures)
      .set({
        status: "accepted",
        signerName: `Handmatig bevestigd door ${context.user.name}`,
        acceptedAt: now,
        updatedAt: now,
      })
      .where(eq(quoteSignatures.id, signing.id));
    await db
      .update(workItems)
      .set({ status: "signed", updatedAt: now })
      .where(eq(workItems.id, item.id));
    await db.insert(auditEvents).values({
      organizationId: context.organization.id,
      workItemId: item.id,
      actor: context.user.email,
      action: "quote_signed",
      details: "Offerte handmatig als ondertekend gemarkeerd",
    });
    return Response.json({ status: "signed" });
  }

  if (payload.action === "cancel") {
    await db
      .update(quoteSignatures)
      .set({ status: "revoked", updatedAt: now })
      .where(eq(quoteSignatures.id, signing.id));
    await db
      .update(workItems)
      .set({ status: "cancelled", updatedAt: now })
      .where(eq(workItems.id, item.id));
    await db.insert(auditEvents).values({
      organizationId: context.organization.id,
      workItemId: item.id,
      actor: context.user.email,
      action: "quote_cancelled",
      details: "Offerte geannuleerd; ondertekenlink is niet meer geldig",
    });
    return Response.json({ status: "cancelled" });
  }

  // Reminder: the original signing token is never stored (only its hash), so
  // a reminder issues a fresh link for the exact same quote snapshot.
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
      { error: "Koppel eerst een mailbox voordat je een herinnering verzendt." },
      { status: 409 },
    );
  }

  const builder = normalizeQuoteBuilder(JSON.parse(signing.quoteSnapshotJson));
  const reminderToken = createSigningToken();
  const signingUrl = appUrl(
    request,
    `/offerte/${encodeURIComponent(reminderToken)}`,
  );
  await db
    .update(quoteSignatures)
    .set({ status: "revoked", updatedAt: now })
    .where(eq(quoteSignatures.id, signing.id));
  await db.insert(quoteSignatures).values({
    id: `qsig_${crypto.randomUUID()}`,
    organizationId: context.organization.id,
    workItemId: item.id,
    tokenHash: await hashSigningToken(reminderToken),
    quoteSnapshotJson: signing.quoteSnapshotJson,
    quoteHash: await hashQuoteSnapshot(builder),
    customerName: signing.customerName,
    customerEmail: signing.customerEmail,
    status: "pending",
    expiresAt: signing.expiresAt,
    sentAt: now,
    updatedAt: now,
  });

  const greeting = signing.customerName.trim().split(/\s+/)[0] || "klant";
  const draft =
    `Beste ${greeting},\n\n` +
    `Vorige week ontving u onze offerte ${builder.quoteNumber} voor "${builder.title}". ` +
    "Heeft u hier nog vragen over, dan horen we het graag.\n\n" +
    `Bekijk en onderteken uw offerte veilig via:\n${signingUrl}\n\n` +
    `Met vriendelijke groeten,\n${builder.companyName}`;

  try {
    const outbound = {
      customerEmail: signing.customerEmail,
      customerName: signing.customerName,
      sourceSubject: item.sourceSubject,
      providerThreadId: item.providerThreadId,
      subjectOverride: `${builder.quoteNumber} - vriendelijke herinnering`,
      draft,
    };
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
            ? `Herinnering verzenden mislukt: ${caught.message}`
            : "Herinnering verzenden mislukt",
      },
      { status: 502 },
    );
  }

  const conversation = parseConversation(item.conversationJson);
  conversation.push({
    role: "assistant",
    body: `Herinnering voor offerte ${builder.quoteNumber} verzonden.\n\n[Beveiligde offertelink opnieuw verzonden]`,
    at: now,
  });
  await db
    .update(workItems)
    .set({ conversationJson: JSON.stringify(conversation), updatedAt: now })
    .where(eq(workItems.id, item.id));
  await db.insert(auditEvents).values({
    organizationId: context.organization.id,
    workItemId: item.id,
    actor: context.user.email,
    action: "quote_reminder",
    details: `Herinnering voor offerte ${builder.quoteNumber} verzonden naar ${signing.customerEmail}`,
  });

  return Response.json({ status: "reminded", quoteSentAt: now });
}

function parseConversation(value: string) {
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}
