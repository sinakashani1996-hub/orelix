import { and, desc, eq } from "drizzle-orm";
import { getDb } from "../db";
import {
  integrations,
  processedMessages,
  workItems,
} from "../db/schema";
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
import { normalizeGmailHistoryId, nextHistoryCursor } from "./gmail-history";
import {
  buildGmailRawMessage,
  type OutboundWorkItemEmail,
} from "./gmail-message";

export { normalizeGmailHistoryId, nextHistoryCursor } from "./gmail-history";
export { buildGmailRawMessage } from "./gmail-message";
export type { OutboundWorkItemEmail } from "./gmail-message";

export const GMAIL_SCOPES = [
  "openid",
  "email",
  "https://www.googleapis.com/auth/gmail.modify",
  "https://www.googleapis.com/auth/gmail.compose",
];

type Integration = typeof integrations.$inferSelect;

export function gmailConfig() {
  const clientId = process.env.GMAIL_CLIENT_ID;
  const clientSecret = process.env.GMAIL_CLIENT_SECRET;
  const encryptionKey = process.env.GMAIL_TOKEN_ENCRYPTION_KEY;
  if (!clientId || !clientSecret || !encryptionKey) return null;
  return {
    clientId,
    clientSecret,
    encryptionKey,
    pubsubTopic: process.env.GMAIL_PUBSUB_TOPIC || null,
    webhookSecret: process.env.GMAIL_WEBHOOK_SECRET || null,
    pubsubAudience: process.env.GMAIL_PUBSUB_AUDIENCE || null,
    pubsubServiceAccountEmail:
      process.env.GMAIL_PUBSUB_SERVICE_ACCOUNT_EMAIL || null,
  };
}

export async function exchangeGoogleCode(code: string, redirectUri: string) {
  const config = requireGmailConfig();
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: config.clientId,
      client_secret: config.clientSecret,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
    }),
  });
  if (!response.ok) {
    throw new Error(`Google token exchange failed: ${response.status}`);
  }
  return (await response.json()) as {
    access_token: string;
    expires_in: number;
    refresh_token?: string;
    scope: string;
  };
}

export async function getGmailProfile(accessToken: string) {
  return gmailJson<{ emailAddress: string; historyId: string | number }>(
    accessToken,
    "https://gmail.googleapis.com/gmail/v1/users/me/profile",
  );
}

export async function registerGmailWatch(accessToken: string) {
  const config = requireGmailConfig();
  if (!config.pubsubTopic) return null;
  const response = await fetch(
    "https://gmail.googleapis.com/gmail/v1/users/me/watch",
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${accessToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        topicName: config.pubsubTopic,
        labelIds: ["INBOX"],
        labelFilterBehavior: "INCLUDE",
      }),
    },
  );
  if (!response.ok) throw new Error(`Gmail watch failed: ${response.status}`);
  return (await response.json()) as {
    historyId: string | number;
    expiration: string;
  };
}

export async function encryptRefreshToken(token: string) {
  const key = await encryptionKey();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    new TextEncoder().encode(token),
  );
  return `${base64(iv)}.${base64(new Uint8Array(encrypted))}`;
}

export async function decryptRefreshToken(value: string) {
  const [ivValue, encryptedValue] = value.split(".");
  if (!ivValue || !encryptedValue) throw new Error("Invalid encrypted token");
  const decrypted = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: fromBase64(ivValue) },
    await encryptionKey(),
    fromBase64(encryptedValue),
  );
  return new TextDecoder().decode(decrypted);
}

export async function accessTokenFor(integration: Integration) {
  const config = requireGmailConfig();
  const refreshToken = await decryptRefreshToken(integration.encryptedRefreshToken);
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
  });
  if (!response.ok) throw new Error(`Google token refresh failed: ${response.status}`);
  const data = (await response.json()) as { access_token: string };
  return data.access_token;
}

export async function ensureGmailWatch(integration: Integration) {
  const renewalWindowMs = 24 * 60 * 60 * 1000;
  const expiration = integration.watchExpiration
    ? new Date(integration.watchExpiration).getTime()
    : 0;
  if (
    integration.status !== "connected" ||
    expiration > Date.now() + renewalWindowMs
  ) {
    return integration;
  }

  const accessToken = await accessTokenFor(integration);
  const watch = await registerGmailWatch(accessToken);
  if (!watch) {
    throw new Error("Gmail Pub/Sub topic is not configured");
  }

  const updatedAt = new Date().toISOString();
  const watchExpiration = new Date(Number(watch.expiration)).toISOString();
  await getDb()
    .update(integrations)
    .set({
      historyId: normalizeGmailHistoryId(
        integration.historyId || watch.historyId,
      ),
      watchExpiration,
      updatedAt,
    })
    .where(eq(integrations.id, integration.id));

  return {
    ...integration,
    historyId: normalizeGmailHistoryId(
      integration.historyId || watch.historyId,
    ),
    watchExpiration,
    updatedAt,
  };
}

export async function processGmailNotification(
  integration: Integration,
  historyId: string,
) {
  const db = getDb();
  const notificationHistoryId = normalizeGmailHistoryId(historyId);
  const updatedAt = new Date().toISOString();

  // First connect: anchor the cursor at the notification and wait for the next
  // push. There is no older cursor to diff against yet.
  if (!integration.historyId) {
    await db
      .update(integrations)
      .set({ historyId: notificationHistoryId, updatedAt })
      .where(eq(integrations.id, integration.id));
    return 0;
  }

  const accessToken = await accessTokenFor(integration);
  const currentHistoryId = normalizeGmailHistoryId(integration.historyId);

  let processed: number;
  let cursor: string;
  try {
    const history = await fetchGmailHistory(accessToken, currentHistoryId);
    const messageIds = collectHistoryMessageIds(history);
    processed = 0;
    for (const [messageId, threadId] of messageIds) {
      processed += await processInboundMessage(
        integration,
        accessToken,
        messageId,
        threadId,
      );
    }
    // The history window was valid: Gmail reported every change since the stored
    // cursor, so advancing to the newer notification id cannot skip anything.
    cursor = nextHistoryCursor({
      historyAvailable: true,
      notificationHistoryId,
      currentHistoryId,
    });
  } catch (caught) {
    // A stale history window (HTTP 404 historyNotAvailable) or a transient Gmail
    // error means the delta since the stored cursor is unreliable. Falling back
    // to a direct recent-messages scan guarantees customer replies are never
    // silently lost. processed_messages dedup keeps this idempotent.
    processed = await recoverRecentMessages(integration, accessToken);
    const liveHistoryId = await getGmailProfile(accessToken)
      .then((profile) => normalizeGmailHistoryId(profile.historyId))
      .catch(() => notificationHistoryId);
    // Recovery covered recent mail; reset the cursor to the live mailbox state so
    // the next push resumes from a valid position. Guard against an implausibly
    // stale profile response and otherwise hold the cursor where it was.
    cursor =
      BigInt(liveHistoryId) >= BigInt(notificationHistoryId)
        ? liveHistoryId
        : nextHistoryCursor({
            historyAvailable: false,
            notificationHistoryId,
            currentHistoryId,
          });
    console.warn(
      JSON.stringify({
        event: "gmail_history_window_recovered",
        organizationId: integration.organizationId,
        recovered: processed,
        error:
          caught instanceof Error
            ? caught.message
            : "Unknown Gmail history error",
      }),
    );
  }

  await db
    .update(integrations)
    .set({ historyId: cursor, updatedAt })
    .where(eq(integrations.id, integration.id));
  return processed;
}

async function fetchGmailHistory(accessToken: string, startHistoryId: string) {
  const historyUrl = new URL(
    "https://gmail.googleapis.com/gmail/v1/users/me/history",
  );
  historyUrl.searchParams.set("startHistoryId", startHistoryId);
  historyUrl.searchParams.set("historyTypes", "messageAdded");
  // Do NOT restrict to labelId=INBOX here. The Gmail watch is registered with
  // labelFilterBehavior INCLUDE on INBOX, so notifications fire for inbox mail,
  // but a reply can already have left the inbox (filter rule, auto-archive) by
  // the time we process it. Filtering the history query the same way would drop
  // those replies silently. Sender-based skipping of our own address and
  // processed_messages dedup keep this correct without the INBOX restriction.
  return gmailJson<{
    history?: Array<{
      messagesAdded?: Array<{ message: { id: string; threadId: string } }>;
    }>;
  }>(accessToken, historyUrl.toString());
}

function collectHistoryMessageIds(history: {
  history?: Array<{
    messagesAdded?: Array<{ message: { id: string; threadId: string } }>;
  }>;
}): Map<string, string> {
  const messageIds = new Map<string, string>();
  for (const event of history.history || []) {
    for (const added of event.messagesAdded || []) {
      messageIds.set(added.message.id, added.message.threadId);
    }
  }
  return messageIds;
}

/**
 * Recovery path used when the incremental history window is unavailable, and on
 * demand through the sync endpoint (?force=true). Lists the most recent messages
 * and processes any not yet claimed. Existing dedup via processed_messages makes
 * this idempotent and safe to rerun. Sender-based skipping ignores our own
 * outgoing mail, so a broad scan stays correct.
 */
export async function recoverRecentMessages(
  integration: Integration,
  accessToken: string,
) {
  const listUrl = new URL(
    "https://gmail.googleapis.com/gmail/v1/users/me/messages",
  );
  listUrl.searchParams.set("maxResults", "20");
  const list = await gmailJson<{
    messages?: Array<{ id: string; threadId: string }>;
  }>(accessToken, listUrl.toString());

  let processed = 0;
  for (const message of list.messages || []) {
    processed += await processInboundMessage(
      integration,
      accessToken,
      message.id,
      message.threadId,
    );
  }
  return processed;
}

async function processInboundMessage(
  integration: Integration,
  accessToken: string,
  messageId: string,
  threadId: string,
): Promise<number> {
  const db = getDb();

  // Claim the provider message id atomically before fetching content. This
  // prevents duplicate processing across concurrent pushes and lets the recovery
  // scan cheaply skip messages already handled, without extra Gmail API calls.
  const claim = await db
    .insert(processedMessages)
    .values({
      id: `processed_${crypto.randomUUID()}`,
      organizationId: integration.organizationId,
      integrationId: integration.id,
      providerMessageId: messageId,
    })
    .onConflictDoNothing()
    .returning({ id: processedMessages.id });
  if (!claim.length) return 0;

  const message = await gmailJson<GmailMessage>(
    accessToken,
    `https://gmail.googleapis.com/gmail/v1/users/me/messages/${messageId}?format=full`,
  );
  const from = header(message, "From");
  // Skip our own outgoing mail (sent via Gmail by the send route). The claim is
  // kept so a later recovery scan does not refetch it.
  if (from.toLowerCase().includes(integration.accountEmail.toLowerCase())) {
    return 0;
  }

  const sender = parseMailbox(from);
  const subject = header(message, "Subject") || "(Geen onderwerp)";
  const body = extractBody(message.payload);
  const mailboxFilter = filterInboundMailboxMessage({
    from,
    subject,
    body,
    autoSubmitted: header(message, "Auto-Submitted"),
    listUnsubscribe: header(message, "List-Unsubscribe"),
    precedence: header(message, "Precedence"),
  });
  if (mailboxFilter.action === "ignore") {
    console.info(JSON.stringify({
      event: "inbound_message_ignored",
      provider: "gmail",
      messageId,
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
        eq(workItems.providerThreadId, threadId),
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
  const receivedAt = new Date(
    Number(message.internalDate || Date.now()),
  ).toISOString();
  const conversation = conversationFor(threadItem);
  conversation.push({
    role: "customer",
    subject,
    body,
    at: receivedAt,
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
    const smart = await analyzeConversationWithAI({
      conversation,
      knownData,
    });
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
    const reason =
      caught instanceof Error ? caught.message : "Unknown AI error";
    console.error(
      JSON.stringify({
        event: "ai_fallback_used",
        threadId,
        reason,
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
    receivedAt,
    dueLabel: "Vandaag",
    draft: analysis.draft,
    providerMessageId: messageId,
    providerThreadId: threadId,
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

function conversationFor(
  item: typeof workItems.$inferSelect | undefined,
): ConversationMessage[] {
  if (!item) return [];
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
    conversation.push({
      role: "assistant",
      body: item.draft,
      at: item.updatedAt,
    });
  }
  return conversation;
}

function parseArray<T>(value: string | null | undefined): T[] {
  try {
    const parsed = JSON.parse(value || "[]");
    return Array.isArray(parsed) ? (parsed as T[]) : [];
  } catch {
    return [];
  }
}

function parseObject<T extends object>(
  value: string | null | undefined,
  fallback: T,
): T {
  try {
    const parsed = JSON.parse(value || "{}");
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as T)
      : fallback;
  } catch {
    return fallback;
  }
}

export async function fetchGmailMessageContent(
  integration: Integration,
  messageId: string,
) {
  const accessToken = await accessTokenFor(integration);
  const message = await gmailJson<GmailMessage>(
    accessToken,
    `https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(messageId)}?format=full`,
  );
  return {
    subject: header(message, "Subject") || "(Geen onderwerp)",
    body: extractBody(message.payload),
  };
}

export async function sendWorkItemEmail(
  integration: Integration,
  workItem: OutboundWorkItemEmail,
) {
  const accessToken = await accessTokenFor(integration);
  const raw = buildGmailRawMessage(workItem);
  const response = await fetch(
    "https://gmail.googleapis.com/gmail/v1/users/me/messages/send",
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${accessToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        raw: base64Url(new TextEncoder().encode(raw)),
        threadId: workItem.providerThreadId || undefined,
      }),
    },
  );
  if (!response.ok) throw new Error(`Gmail send failed: ${response.status}`);
  return (await response.json()) as { id: string; threadId: string };
}

export async function integrationForOrganization(organizationId: string) {
  const db = getDb();
  return (
    await db
      .select()
      .from(integrations)
      .where(
        and(
          eq(integrations.organizationId, organizationId),
          eq(integrations.provider, "gmail"),
        ),
      )
      .limit(1)
  )[0];
}

function requireGmailConfig() {
  const config = gmailConfig();
  if (!config) throw new Error("Gmail integration is not configured");
  return config;
}

async function encryptionKey() {
  const raw = requireGmailConfig().encryptionKey;
  const bytes = fromBase64(raw);
  if (bytes.byteLength !== 32) {
    throw new Error("GMAIL_TOKEN_ENCRYPTION_KEY must decode to 32 bytes");
  }
  return crypto.subtle.importKey("raw", bytes, "AES-GCM", false, [
    "encrypt",
    "decrypt",
  ]);
}

async function gmailJson<T>(accessToken: string, url: string): Promise<T> {
  const response = await fetch(url, {
    headers: { authorization: `Bearer ${accessToken}` },
  });
  if (!response.ok) {
    const detail = (await response.text()).replace(/\s+/g, " ").trim();
    throw new Error(
      `Gmail API failed: ${response.status}${detail ? ` — ${detail.slice(0, 500)}` : ""}`,
    );
  }
  return (await response.json()) as T;
}

type GmailPart = {
  mimeType?: string;
  body?: { data?: string };
  parts?: GmailPart[];
  headers?: Array<{ name: string; value: string }>;
};
type GmailMessage = {
  id: string;
  threadId: string;
  internalDate?: string;
  payload: GmailPart;
};

function header(message: GmailMessage, name: string) {
  return (
    message.payload.headers?.find(
      (item) => item.name.toLowerCase() === name.toLowerCase(),
    )?.value || ""
  );
}

function extractBody(part: GmailPart): string {
  if (part.mimeType === "text/plain" && part.body?.data) {
    return new TextDecoder().decode(fromBase64Url(part.body.data));
  }
  for (const child of part.parts || []) {
    const value = extractBody(child);
    if (value) return value;
  }
  if (part.body?.data) {
    return new TextDecoder().decode(fromBase64Url(part.body.data));
  }
  return "";
}

function parseMailbox(value: string) {
  const match = value.match(/^(.*?)\s*<([^>]+)>$/);
  if (match) {
    return {
      name: match[1].replace(/^"|"$/g, "").trim() || match[2].split("@")[0],
      email: match[2].trim(),
    };
  }
  const email = value.trim();
  return { name: email.split("@")[0] || "Klant", email };
}

function base64(value: Uint8Array) {
  let binary = "";
  value.forEach((byte) => (binary += String.fromCharCode(byte)));
  return btoa(binary);
}

function fromBase64(value: string) {
  const padded = value.padEnd(Math.ceil(value.length / 4) * 4, "=");
  const binary = atob(padded);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

function fromBase64Url(value: string) {
  return fromBase64(value.replace(/-/g, "+").replace(/_/g, "/"));
}

function base64Url(value: Uint8Array) {
  return base64(value).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}
