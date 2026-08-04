import { and, eq } from "drizzle-orm";
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
import {
  normalizeQuoteBuilder,
  quoteValidationIssues,
} from "../../../../../lib/quote-builder";
import { generateQuotePdf } from "../../../../../lib/quote-pdf";
import { appUrl } from "../../../../../lib/app-url";
import {
  createSigningToken,
  hashQuoteSnapshot,
  hashSigningToken,
} from "../../../../../lib/quote-signing";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const context = await getAppContext();
  if (!context?.organization) {
    return Response.json({ error: "Niet aangemeld" }, { status: 401 });
  }
  const { id } = await params;
  await ensureDatabase();
  const db = getDb();
  const item = (
    await db
      .select()
      .from(workItems)
      .where(
        and(
          eq(workItems.id, id),
          eq(workItems.organizationId, context.organization.id),
        ),
      )
      .limit(1)
  )[0];
  if (!item) {
    return Response.json({ error: "Dossier niet gevonden" }, { status: 404 });
  }
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
  if (!["needs_approval", "draft_ready"].includes(item.status)) {
    return Response.json(
      { error: "Dit dossier is niet klaar voor verzending." },
      { status: 409 },
    );
  }

  const payload = (await request.json().catch(() => ({}))) as {
    draft?: string;
  };
  const finalDraft =
    typeof payload.draft === "string" ? payload.draft : item.draft;
  if (!finalDraft.trim()) {
    return Response.json(
      { error: "Het antwoord mag niet leeg zijn." },
      { status: 400 },
    );
  }

  let attachment:
    | { filename: string; contentType: string; bytes: Uint8Array }
    | undefined;
  let subjectOverride: string | undefined;
  let signingToken: string | undefined;
  let signingRecordId: string | undefined;
  let deliveredDraft = finalDraft;
  try {
    const storedQuote = JSON.parse(item.quoteJson) as {
      ready?: boolean;
      builder?: unknown;
    };
    if (storedQuote.ready === true) {
      const builder = normalizeQuoteBuilder(storedQuote.builder);
      const issues = quoteValidationIssues(builder);
      if (issues.length) {
        return Response.json(
          { error: `Maak de offerte eerst compleet: ${issues.join(", ")}` },
          { status: 409 },
        );
      }
      attachment = {
        filename: `${safeFilename(builder.quoteNumber)}.pdf`,
        contentType: "application/pdf",
        bytes: await generateQuotePdf(builder),
      };
      subjectOverride = `${builder.quoteNumber} - ${builder.title}`;
      signingToken = createSigningToken();
      signingRecordId = `qsig_${crypto.randomUUID()}`;
      const signingUrl = appUrl(
        request,
        `/offerte/${encodeURIComponent(signingToken)}`,
      );
      deliveredDraft = `${finalDraft.trim()}\n\nBekijk en onderteken uw offerte veilig via:\n${signingUrl}`;
      const now = new Date().toISOString();
      await db
        .update(quoteSignatures)
        .set({ status: "revoked", updatedAt: now })
        .where(
          and(
            eq(quoteSignatures.organizationId, context.organization.id),
            eq(quoteSignatures.workItemId, item.id),
            eq(quoteSignatures.status, "pending"),
          ),
        );
      await db.insert(quoteSignatures).values({
        id: signingRecordId,
        organizationId: context.organization.id,
        workItemId: item.id,
        tokenHash: await hashSigningToken(signingToken),
        quoteSnapshotJson: JSON.stringify(builder),
        quoteHash: await hashQuoteSnapshot(builder),
        customerName: builder.customerName,
        customerEmail: builder.customerEmail,
        status: "pending",
        expiresAt: `${builder.validUntil}T23:59:59.999Z`,
        sentAt: now,
        updatedAt: now,
      });
    }
  } catch (caught) {
    return Response.json(
      {
        error:
          caught instanceof Error
            ? `De offerte is nog niet verzendklaar: ${caught.message}`
            : "De offerte is nog niet verzendklaar",
      },
      { status: 409 },
    );
  }

  if (finalDraft !== item.draft) {
    await db
      .update(workItems)
      .set({ draft: finalDraft, updatedAt: new Date().toISOString() })
      .where(
        and(
          eq(workItems.id, item.id),
          eq(workItems.organizationId, context.organization.id),
        ),
      );
    await db.insert(auditEvents).values({
      organizationId: context.organization.id,
      workItemId: item.id,
      actor: context.user.email,
      action: "draft_edited",
      details: "Conceptantwoord aangepast voor verzending",
    });
  }

  let sent: { id: string; threadId: string };
  try {
    sent = integration.provider === "imap_smtp"
      ? await sendSmtpWorkItemEmail(integration, {
        ...item,
        draft: deliveredDraft,
        attachment,
        subjectOverride,
      })
      : await sendWorkItemEmail(integration, {
          ...item,
          draft: deliveredDraft,
          attachment,
          subjectOverride,
        });
  } catch (caught) {
    if (signingRecordId) {
      await db
        .update(quoteSignatures)
        .set({ status: "revoked", updatedAt: new Date().toISOString() })
        .where(eq(quoteSignatures.id, signingRecordId));
    }
    throw caught;
  }
  const now = new Date().toISOString();
  const conversation = parseConversation(item.conversationJson);
  // Never persist the bearer signing token in the dossier. The customer gets
  // it by e-mail; Orelix stores only its SHA-256 hash.
  conversation.push({
    role: "assistant",
    body: signingRecordId
      ? `${finalDraft.trim()}\n\n[Beveiligde offertelink verzonden]`
      : finalDraft,
    at: now,
  });
  await db
    .update(workItems)
    .set({
      status: "sent",
      conversationJson: JSON.stringify(conversation),
      providerThreadId: sent.threadId || item.providerThreadId,
      updatedAt: now,
    })
    .where(eq(workItems.id, item.id));
  await db.insert(auditEvents).values({
    organizationId: context.organization.id,
    workItemId: item.id,
    actor: context.user.email,
    action: "sent",
    details: signingRecordId
      ? `Offerte-uitnodiging ${sent.id} verzonden na expliciete goedkeuring`
      : `E-mail ${sent.id} verzonden na expliciete goedkeuring`,
  });

  return Response.json({
    status: "sent",
    messageId: sent.id,
    signatureRequested: Boolean(signingRecordId),
  });
}

function safeFilename(value: string) {
  return value
    .normalize("NFKD")
    .replace(/[^\w.-]+/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 100);
}

function parseConversation(value: string) {
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}
