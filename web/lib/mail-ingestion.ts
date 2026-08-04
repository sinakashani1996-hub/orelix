import { and, desc, eq } from "drizzle-orm";
import { getDb } from "../db";
import { integrations, processedMessages, workItems } from "../db/schema";
import {
  analyzeConversationWithAI,
  type ConversationMessage,
  type ExtractedQuoteData,
  type SmartEmailAnalysis,
} from "./ai-assistant";
import {
  analyzeEmailForModule,
  analyzeInboundEmail,
  inferCustomerName,
  type QuoteAnalysis,
} from "./quote-analyzer";
import { filterInboundMailboxMessage } from "./inbox-filter";

type Integration = typeof integrations.$inferSelect;

export type IncomingMailboxMessage = {
  id: string;
  threadId: string;
  from: string;
  subject: string;
  body: string;
  receivedAt: string;
};

/**
 * Stores and analyses one inbound message from any mailbox provider. The
 * provider-specific adapter is responsible only for fetching a normalised
 * message; this keeps customer history and AI behaviour identical for Gmail
 * and IMAP.
 */
export async function ingestIncomingMailboxMessage(
  integration: Integration,
  message: IncomingMailboxMessage,
): Promise<number> {
  const db = getDb();
  const claim = await db
    .insert(processedMessages)
    .values({
      id: `processed_${crypto.randomUUID()}`,
      organizationId: integration.organizationId,
      integrationId: integration.id,
      providerMessageId: message.id,
    })
    .onConflictDoNothing()
    .returning({ id: processedMessages.id });
  if (!claim.length) return 0;

  if (message.from.toLowerCase().includes(integration.accountEmail.toLowerCase())) {
    return 0;
  }

  const sender = parseMailbox(message.from);
  const subject = message.subject || "(Geen onderwerp)";
  const body = message.body.trim();
  if (!body) return 0;
  const mailboxFilter = filterInboundMailboxMessage({
    from: message.from,
    subject,
    body,
  });
  if (mailboxFilter.action === "ignore") {
    console.info(JSON.stringify({
      event: "inbound_message_ignored",
      provider: "imap_smtp",
      messageId: message.id,
      reason: mailboxFilter.reason,
    }));
    return 0;
  }

  const [threadItem] = await db
    .select()
    .from(workItems)
    .where(
      and(
        eq(workItems.organizationId, integration.organizationId),
        eq(workItems.mailboxIntegrationId, integration.id),
        eq(workItems.providerThreadId, message.threadId),
      ),
    )
    .orderBy(desc(workItems.updatedAt))
    .limit(1);
  const [knownContact] = threadItem
    ? [threadItem]
    : await db
        .select()
        .from(workItems)
        .where(
          and(
            eq(workItems.organizationId, integration.organizationId),
            eq(workItems.mailboxIntegrationId, integration.id),
            eq(workItems.customerEmail, sender.email),
          ),
        )
        .orderBy(desc(workItems.updatedAt))
        .limit(1);

  const fallbackName = knownContact?.customerName || sender.name;
  const customerName = inferCustomerName(body, fallbackName);
  const conversation = conversationFor(threadItem);
  conversation.push({
    role: "customer",
    subject,
    body,
    at: message.receivedAt,
  });
  const knownData = parseObject<Partial<ExtractedQuoteData>>(
    knownContact?.extractedJson,
    {},
  );
  const existingQuote = parseObject<Record<string, unknown>>(
    knownContact?.quoteJson,
    {},
  );

  let analysis: QuoteAnalysis | SmartEmailAnalysis;
  let extractedJson = JSON.stringify(knownData);
  let quoteJson = "{}";
  let aiProvider = "rules";
  try {
    const smart = await analyzeConversationWithAI({ conversation, knownData });
    analysis = smart;
    extractedJson = JSON.stringify(smart.extracted);
    quoteJson = JSON.stringify({
      ready: smart.quoteReady,
      missingFields: smart.missingFields,
      ...smart.quote,
      ...(existingQuote.builder ? { builder: existingQuote.builder } : {}),
    });
    aiProvider = smart.aiProvider;
  } catch (caught) {
    console.error(
      JSON.stringify({
        event: "ai_fallback_used",
        threadId: message.threadId,
        reason: caught instanceof Error ? caught.message : "Unknown AI error",
      }),
    );
    analysis =
      threadItem?.moduleId === "quote_assistant"
        ? analyzeEmailForModule("quote_assistant", subject, body, customerName)
        : analyzeInboundEmail(subject, body, customerName);
  }

  const resolvedCustomerName =
    "customerName" in analysis && analysis.customerName
      ? analysis.customerName
      : customerName;
  const values = {
    moduleId: analysis.moduleId,
    customerName: resolvedCustomerName,
    customerEmail: sender.email,
    title: analysis.title,
    summary: analysis.summary,
    status: analysis.status,
    priority: analysis.kind === "service_request" ? "high" : "normal",
    confidence: analysis.confidence,
    receivedAt: message.receivedAt,
    dueLabel: "Vandaag",
    draft: analysis.draft,
    providerMessageId: message.id,
    providerThreadId: message.threadId,
    mailboxIntegrationId: integration.id,
    sourceSubject: subject,
    sourceBody: body,
    kind: analysis.kind,
    conversationJson: JSON.stringify(conversation),
    extractedJson,
    quoteJson,
    aiProvider,
    updatedAt: new Date().toISOString(),
  };
  if (threadItem) {
    await db
      .update(workItems)
      .set(values)
      .where(
        and(
          eq(workItems.id, threadItem.id),
          eq(workItems.organizationId, integration.organizationId),
        ),
      );
  } else {
    await db.insert(workItems).values({
      id: `case_${crypto.randomUUID()}`,
      organizationId: integration.organizationId,
      ...values,
    });
  }
  return 1;
}

function conversationFor(item: typeof workItems.$inferSelect | undefined) {
  if (!item) return [] as ConversationMessage[];
  const stored = parseArray<ConversationMessage>(item.conversationJson);
  if (stored.length) return stored;
  const conversation: ConversationMessage[] = [];
  if (item.sourceBody) {
    conversation.push({
      role: "customer",
      subject: item.sourceSubject || "(Geen onderwerp)",
      body: item.sourceBody,
      at: item.receivedAt,
    });
  }
  if (item.draft) {
    conversation.push({ role: "assistant", body: item.draft, at: item.updatedAt });
  }
  return conversation;
}

function parseMailbox(value: string) {
  const match = value.match(/^(.*?)\s*<([^>]+)>$/);
  if (match) {
    return {
      name: match[1].replace(/^"|"$/g, "").trim() || match[2].split("@")[0],
      email: match[2].trim().toLowerCase(),
    };
  }
  const email = value.trim().toLowerCase();
  return { name: email.split("@")[0] || "Klant", email };
}

function parseArray<T>(value: string | null | undefined) {
  try {
    const parsed = JSON.parse(value || "[]");
    return Array.isArray(parsed) ? (parsed as T[]) : [];
  } catch {
    return [];
  }
}

function parseObject<T extends object>(value: string | null | undefined, fallback: T) {
  try {
    const parsed = JSON.parse(value || "{}");
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as T)
      : fallback;
  } catch {
    return fallback;
  }
}
