import { and, eq } from "drizzle-orm";
import { getDb } from "../../../../../db";
import { auditEvents, workItems } from "../../../../../db/schema";
import { getAppContext } from "../../../../../lib/context";
import {
  integrationForOrganization,
  sendWorkItemEmail,
} from "../../../../../lib/gmail";
import {
  normalizeQuoteBuilder,
  quoteValidationIssues,
} from "../../../../../lib/quote-builder";
import { generateQuotePdf } from "../../../../../lib/quote-pdf";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const context = await getAppContext();
  if (!context?.organization) {
    return Response.json({ error: "Niet aangemeld" }, { status: 401 });
  }
  const { id } = await params;
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
  const integration = await integrationForOrganization(context.organization.id);
  if (!integration) {
    return Response.json(
      { error: "Koppel eerst Gmail voordat je een bericht verzendt." },
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

  const sent = await sendWorkItemEmail(integration, {
    ...item,
    draft: finalDraft,
    attachment,
    subjectOverride,
  });
  const now = new Date().toISOString();
  const conversation = parseConversation(item.conversationJson);
  conversation.push({ role: "assistant", body: finalDraft, at: now });
  await db
    .update(workItems)
    .set({
      status: "sent",
      conversationJson: JSON.stringify(conversation),
      updatedAt: now,
    })
    .where(eq(workItems.id, item.id));
  await db.insert(auditEvents).values({
    organizationId: context.organization.id,
    workItemId: item.id,
    actor: context.user.email,
    action: "sent",
    details: `Gmail message ${sent.id} sent after explicit approval`,
  });

  return Response.json({ status: "sent", messageId: sent.id });
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
