import { and, desc, eq } from "drizzle-orm";
import { ensureDatabase, getDb } from "../../../db";
import {
  auditEvents,
  integrations,
  modules,
  quoteSignatures,
  workItems,
} from "../../../db/schema";
import { getAppContext } from "../../../lib/context";
import {
  ensureGmailWatch,
  fetchGmailMessageContent,
  integrationForOrganization,
} from "../../../lib/gmail";
import {
  analyzeConversationWithAI,
  type ConversationMessage,
  type ExtractedQuoteData,
} from "../../../lib/ai-assistant";
import {
  analyzeEmailForModule,
  inferCustomerName,
  normalizeStoredDraft,
  type AssignableModuleId,
} from "../../../lib/quote-analyzer";
import { normalizeQuoteBuilder } from "../../../lib/quote-builder";

const assignableModuleIds: AssignableModuleId[] = [
  "quote_assistant",
  "inbox_assistant",
  "service_assistant",
];

const seedModules = [
  {
    id: "quote_assistant",
    name: "Offerte Assistent",
    description: "Van aanvraag naar gecontroleerd concept",
    status: "active",
  },
  {
    id: "inbox_assistant",
    name: "Inbox Assistent",
    description: "Sorteert en prioriteert binnenkomende mail",
    status: "beta",
  },
  {
    id: "service_assistant",
    name: "Service Assistent",
    description: "Herkent storingen en servicevragen",
    status: "beta",
  },
  {
    id: "planning_assistant",
    name: "Planning Assistent",
    description: "Plant afspraken en teams",
    status: "coming_soon",
  },
  {
    id: "crm_assistant",
    name: "CRM Assistent",
    description: "Houdt klantdossiers actueel",
    status: "coming_soon",
  },
];

async function ensureModuleCatalog() {
  const db = getDb();
  if ((await db.select().from(modules).limit(1)).length === 0) {
    await db.insert(modules).values(seedModules);
  }
}

export async function GET() {
  const context = await getAppContext();
  if (!context?.organization) {
    return Response.json({ error: "Niet aangemeld" }, { status: 401 });
  }

  await ensureDatabase();
  await ensureModuleCatalog();
  const db = getDb();
  const [allItems, moduleRows, gmail, imap, signatureRows] = await Promise.all([
    db
      .select()
      .from(workItems)
      .where(eq(workItems.organizationId, context.organization.id))
      .orderBy(desc(workItems.receivedAt)),
    db.select().from(modules),
    integrationForOrganization(context.organization.id),
    db
      .select()
      .from(integrations)
      .where(
        and(
          eq(integrations.organizationId, context.organization.id),
          eq(integrations.provider, "imap_smtp"),
        ),
      )
      .limit(1)
      .then((rows) => rows[0]),
    db
      .select()
      .from(quoteSignatures)
      .where(eq(quoteSignatures.organizationId, context.organization.id))
      .orderBy(desc(quoteSignatures.sentAt)),
  ]);
  // A workspace can retain old integrations, but its queue must show cases
  // from the mailbox currently being used. The most recently linked mailbox
  // is therefore the active one until we add an explicit mailbox switcher.
  let activeMailbox = [gmail, imap]
    .filter((integration): integration is NonNullable<typeof integration> => Boolean(integration))
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0] || null;
  let activeGmail = activeMailbox?.provider === "gmail" ? activeMailbox : null;
  let gmailNeedsReconnect = false;
  if (activeGmail) {
    try {
      activeGmail = await ensureGmailWatch(activeGmail);
      activeMailbox = activeGmail;
    } catch (caught) {
      gmailNeedsReconnect = true;
      const message =
        caught instanceof Error ? caught.message : "Unknown Gmail watch error";
      console.error("Gmail watch renewal failed:", message);
    }
  }

  // Historical cases are never deleted when a customer changes mailbox; they
  // are simply kept out of the active mailbox queue.
  const items = activeMailbox
    ? allItems.filter(
        (item) =>
          // Handmatig aangemaakte offertes horen bij de workspace, niet bij
          // een specifieke mailbox. Ze blijven daarom zichtbaar wanneer de
          // gebruiker later van mailbox wisselt.
          !item.mailboxIntegrationId ||
          item.mailboxIntegrationId === activeMailbox!.id,
      )
    : allItems.filter((item) => !item.mailboxIntegrationId);

  if (activeGmail) {
    const missingSource = items
      .filter((item) => item.providerMessageId && !item.sourceBody)
      .slice(0, 10);
    for (const item of missingSource) {
      try {
        const source = await fetchGmailMessageContent(
          activeGmail,
          item.providerMessageId!,
        );
        await db
          .update(workItems)
          .set({
            sourceSubject: source.subject,
            sourceBody: source.body,
            updatedAt: new Date().toISOString(),
          })
          .where(
            and(
              eq(workItems.id, item.id),
              eq(workItems.organizationId, context.organization.id),
            ),
          );
        item.sourceSubject = source.subject;
        item.sourceBody = source.body;
      } catch (caught) {
        const message =
          caught instanceof Error
            ? caught.message
            : "Unknown Gmail source backfill error";
        console.error(`Gmail source backfill failed for ${item.id}:`, message);
      }
    }
  }

  for (const item of items) {
    if (!item.sourceBody) continue;
    const customerName = inferCustomerName(item.sourceBody, item.customerName);
    const draft = normalizeStoredDraft(
      item.draft,
      item.customerName,
      customerName,
    );
    if (customerName === item.customerName && draft === item.draft) continue;
    await db
      .update(workItems)
      .set({
        customerName,
        draft,
        updatedAt: new Date().toISOString(),
      })
      .where(
        and(
          eq(workItems.id, item.id),
          eq(workItems.organizationId, context.organization.id),
        ),
      );
    item.customerName = customerName;
    item.draft = draft;
  }

  const latestSignatures = new Map<string, (typeof signatureRows)[number]>();
  for (const signature of signatureRows) {
    if (!latestSignatures.has(signature.workItemId)) {
      latestSignatures.set(signature.workItemId, signature);
    }
  }
  const itemsWithQuoteStatus = items.map((item) => {
    const signature = latestSignatures.get(item.id);
    if (!signature || signature.status === "revoked") return item;
    return {
      ...item,
      quoteStatus:
        signature.status === "accepted"
          ? "signed"
          : signature.viewedAt
            ? "viewed"
            : "sent",
      quoteSentAt: signature.sentAt,
      quoteViewedAt: signature.viewedAt,
      quoteSignedAt: signature.acceptedAt,
    };
  });

  return Response.json({
    items: itemsWithQuoteStatus,
    modules: moduleRows,
    user: { name: context.user.name, email: context.user.email },
    organization: context.organization,
    integration: activeMailbox
      ? {
          provider: activeMailbox.provider as "gmail" | "imap_smtp",
          status: activeGmail
            ? gmailNeedsReconnect
              ? "needs_reconnect"
              : activeGmail.status
            : activeMailbox.status,
          accountEmail: activeMailbox.accountEmail,
          watchExpiration: activeGmail?.watchExpiration || null,
          updatedAt: activeMailbox.updatedAt,
        }
      : null,
  });
}

export async function POST(request: Request) {
  const context = await getAppContext();
  if (!context?.organization) {
    return Response.json({ error: "Niet aangemeld" }, { status: 401 });
  }

  const payload = (await request.json()) as {
    customerName?: string;
    customerEmail?: string;
    customerAddress?: string;
    title?: string;
  };
  const customerName = payload.customerName?.trim() || "";
  const customerEmail = payload.customerEmail?.trim().toLowerCase() || "";
  const customerAddress = payload.customerAddress?.trim() || "";
  const title = payload.title?.trim() || "Offerte zonnepanelen";

  if (!customerName || !customerEmail) {
    return Response.json(
      { error: "Vul minstens de naam en het e-mailadres van de klant in" },
      { status: 400 },
    );
  }
  if (!/^\S+@\S+\.\S+$/.test(customerEmail)) {
    return Response.json({ error: "Vul een geldig e-mailadres in" }, { status: 400 });
  }

  await ensureDatabase();
  await ensureModuleCatalog();
  const db = getDb();
  const now = new Date().toISOString();
  const id = `manual_quote_${crypto.randomUUID()}`;
  const quoteJson = JSON.stringify({
    ready: true,
    title,
    introduction: `Beste ${customerName}, hierbij bezorgen wij u ons voorstel.`,
    scope: ["Levering en installatie van zonnepanelen"],
    assumptions: [],
    validityDays: 30,
  });
  const [item] = await db
    .insert(workItems)
    .values({
      id,
      organizationId: context.organization.id,
      moduleId: "quote_assistant",
      customerName,
      customerEmail,
      title: "Handmatige offerte",
      summary: customerAddress
        ? `Offerte opmaken voor ${customerAddress}`
        : "Handmatig aangemaakte offerte",
      status: "needs_approval",
      priority: "normal",
      confidence: 100,
      receivedAt: now,
      dueLabel: "Vandaag",
      sourceSubject: title,
      kind: "quote_request",
      extractedJson: JSON.stringify(
        customerAddress ? { address: customerAddress } : {},
      ),
      quoteJson,
      aiProvider: "manual",
      updatedAt: now,
    })
    .returning();

  await db.insert(auditEvents).values({
    organizationId: context.organization.id,
    workItemId: id,
    actor: context.user.email,
    action: "manual_quote_created",
    details: `Handmatige offerte aangemaakt voor ${customerName}`,
  });

  return Response.json({ item }, { status: 201 });
}

export async function PATCH(request: Request) {
  const context = await getAppContext();
  if (!context?.organization) {
    return Response.json({ error: "Niet aangemeld" }, { status: 401 });
  }

  const payload = (await request.json()) as {
    id?: string;
    status?: "dismissed" | "needs_approval";
    draft?: string;
    moduleId?: AssignableModuleId;
    quoteBuilder?: unknown;
  };
  if (
    !payload.id ||
    (payload.status === undefined &&
      payload.draft === undefined &&
      payload.moduleId === undefined &&
      payload.quoteBuilder === undefined)
  ) {
    return Response.json(
      { error: "id en minstens één wijziging zijn verplicht" },
      { status: 400 },
    );
  }
  if (
    payload.moduleId !== undefined &&
    !assignableModuleIds.includes(payload.moduleId)
  ) {
    return Response.json(
      { error: "Deze assistent kan niet handmatig worden toegewezen" },
      { status: 400 },
    );
  }
  if (payload.draft !== undefined && !payload.draft.trim()) {
    return Response.json(
      { error: "Het antwoord mag niet leeg zijn" },
      { status: 400 },
    );
  }

  const db = getDb();
  const updatedAt = new Date().toISOString();

  if (payload.quoteBuilder !== undefined) {
    const [existing] = await db
      .select()
      .from(workItems)
      .where(
        and(
          eq(workItems.id, payload.id),
          eq(workItems.organizationId, context.organization.id),
        ),
      )
      .limit(1);
    if (!existing) {
      return Response.json({ error: "Dossier niet gevonden" }, { status: 404 });
    }
    if (existing.moduleId !== "quote_assistant") {
      return Response.json(
        { error: "Alleen offertedossiers hebben een offertebouwer" },
        { status: 409 },
      );
    }
    try {
      const builder = normalizeQuoteBuilder(payload.quoteBuilder);
      const stored = parseObject<Record<string, unknown>>(
        existing.quoteJson,
        {},
      );
      const quoteJson = JSON.stringify({ ...stored, builder });
      const [updated] = await db
        .update(workItems)
        .set({
          quoteJson,
          updatedAt,
          ...(payload.draft !== undefined ? { draft: payload.draft } : {}),
        })
        .where(
          and(
            eq(workItems.id, payload.id),
            eq(workItems.organizationId, context.organization.id),
          ),
        )
        .returning();
      await db.insert(auditEvents).values({
        organizationId: context.organization.id,
        workItemId: payload.id,
        actor: context.user.email,
        action: "quote_edited",
        details:
          payload.draft !== undefined
            ? `Offerte ${builder.quoteNumber} en begeleidende e-mail aangepast`
            : `Offerte ${builder.quoteNumber} aangepast`,
      });
      return Response.json({ item: updated, builder });
    } catch (caught) {
      return Response.json(
        {
          error:
            caught instanceof Error
              ? caught.message
              : "De offertegegevens zijn ongeldig",
        },
        { status: 400 },
      );
    }
  }

  if (payload.moduleId) {
    const [existing] = await db
      .select()
      .from(workItems)
      .where(
        and(
          eq(workItems.id, payload.id),
          eq(workItems.organizationId, context.organization.id),
        ),
      )
      .limit(1);
    if (!existing) {
      return Response.json({ error: "Dossier niet gevonden" }, { status: 404 });
    }
    if (!existing.sourceBody.trim()) {
      return Response.json(
        {
          error:
            "De originele e-mail ontbreekt. Open het dossier opnieuw en probeer nogmaals.",
        },
        { status: 409 },
      );
    }

    let customerName = inferCustomerName(
      existing.sourceBody,
      existing.customerName,
    );
    let analysis = analyzeEmailForModule(
      payload.moduleId,
      existing.sourceSubject || "",
      existing.sourceBody,
      customerName,
    );
    let extractedJson = existing.extractedJson;
    let quoteJson = existing.quoteJson;
    let aiProvider = "rules";
    const conversation = parseConversation(existing.conversationJson);
    if (!conversation.length) {
      conversation.push({
        role: "customer",
        subject: existing.sourceSubject || "(Geen onderwerp)",
        body: existing.sourceBody,
        at: existing.receivedAt,
      });
    }
    try {
      const smart = await analyzeConversationWithAI({
        conversation,
        knownData: parseKnownData(existing.extractedJson),
        preferredModule: payload.moduleId,
      });
      analysis = smart;
      customerName = smart.customerName || customerName;
      extractedJson = JSON.stringify(smart.extracted);
      quoteJson = JSON.stringify({
        ready: smart.quoteReady,
        missingFields: smart.missingFields,
        ...smart.quote,
      });
      aiProvider = smart.aiProvider;
    } catch (caught) {
      console.error(
        JSON.stringify({
          event: "manual_reanalysis_fallback",
          workItemId: existing.id,
          error:
            caught instanceof Error ? caught.message : "Unknown AI error",
        }),
      );
    }
    const [reassigned] = await db
      .update(workItems)
      .set({
        moduleId: analysis.moduleId,
        customerName,
        kind: analysis.kind,
        title: analysis.title,
        summary: analysis.summary,
        status: analysis.status,
        confidence: analysis.confidence,
        draft: analysis.draft,
        conversationJson: JSON.stringify(conversation),
        extractedJson,
        quoteJson,
        aiProvider,
        updatedAt,
      })
      .where(
        and(
          eq(workItems.id, payload.id),
          eq(workItems.organizationId, context.organization.id),
        ),
      )
      .returning();

    await db.insert(auditEvents).values({
      organizationId: context.organization.id,
      workItemId: payload.id,
      actor: context.user.email,
      action: "reassigned",
      details: `Opnieuw verwerkt door ${payload.moduleId}`,
    });
    return Response.json({ item: reassigned });
  }

  const changes: {
    updatedAt: string;
    status?: "dismissed" | "needs_approval";
    draft?: string;
  } = { updatedAt };
  if (payload.status !== undefined) changes.status = payload.status;
  if (payload.draft !== undefined) changes.draft = payload.draft;
  const [updated] = await db
    .update(workItems)
    .set(changes)
    .where(
      and(
        eq(workItems.id, payload.id),
        eq(workItems.organizationId, context.organization.id),
      ),
    )
    .returning();
  if (!updated) {
    return Response.json({ error: "Dossier niet gevonden" }, { status: 404 });
  }

  await db.insert(auditEvents).values({
    organizationId: context.organization.id,
    workItemId: payload.id,
    actor: context.user.email,
    action: payload.draft !== undefined ? "draft_edited" : payload.status!,
    details:
      payload.draft !== undefined
        ? "Conceptantwoord handmatig aangepast"
        : `Status gewijzigd naar ${payload.status}`,
  });
  return Response.json({ item: updated });
}

export async function DELETE(request: Request) {
  const context = await getAppContext();
  if (!context?.organization) {
    return Response.json({ error: "Niet aangemeld" }, { status: 401 });
  }

  const payload = (await request.json()) as { id?: string };
  if (!payload.id) {
    return Response.json({ error: "id is verplicht" }, { status: 400 });
  }

  const db = getDb();
  const [existing] = await db
    .select({
      id: workItems.id,
      status: workItems.status,
    })
    .from(workItems)
    .where(
      and(
        eq(workItems.id, payload.id),
        eq(workItems.organizationId, context.organization.id),
      ),
    )
    .limit(1);

  if (!existing) {
    return Response.json({ error: "Dossier niet gevonden" }, { status: 404 });
  }
  if (existing.status !== "dismissed") {
    return Response.json(
      { error: "Alleen gearchiveerde dossiers kunnen worden verwijderd" },
      { status: 409 },
    );
  }

  await db
    .delete(auditEvents)
    .where(
      and(
        eq(auditEvents.workItemId, payload.id),
        eq(auditEvents.organizationId, context.organization.id),
      ),
    );
  await db
    .delete(quoteSignatures)
    .where(
      and(
        eq(quoteSignatures.workItemId, payload.id),
        eq(quoteSignatures.organizationId, context.organization.id),
      ),
    );
  await db
    .delete(workItems)
    .where(
      and(
        eq(workItems.id, payload.id),
        eq(workItems.organizationId, context.organization.id),
      ),
    );

  return Response.json({ deleted: true });
}

function parseConversation(value: string): ConversationMessage[] {
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? (parsed as ConversationMessage[]) : [];
  } catch {
    return [];
  }
}

function parseKnownData(value: string): Partial<ExtractedQuoteData> {
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Partial<ExtractedQuoteData>)
      : {};
  } catch {
    return {};
  }
}

function parseObject<T extends object>(value: string, fallback: T): T {
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as T)
      : fallback;
  } catch {
    return fallback;
  }
}
