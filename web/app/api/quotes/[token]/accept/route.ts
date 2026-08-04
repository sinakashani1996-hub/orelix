import { and, eq } from "drizzle-orm";
import { ensureDatabase, getDb } from "../../../../../db";
import {
  auditEvents,
  integrations,
  quoteSignatures,
  workItems,
} from "../../../../../db/schema";
import { sendWorkItemEmail } from "../../../../../lib/gmail";
import { sendSmtpWorkItemEmail } from "../../../../../lib/smtp";
import { normalizeQuoteBuilder } from "../../../../../lib/quote-builder";
import { generateQuotePdf } from "../../../../../lib/quote-pdf";
import {
  hashSigningToken,
  parseSignatureDataUrl,
  safeSignerName,
  type QuoteAcceptance,
} from "../../../../../lib/quote-signing";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;
  if (token.length < 20 || token.length > 120) return unavailable();
  const payload = (await request.json().catch(() => ({}))) as {
    signerName?: unknown;
    signatureDataUrl?: unknown;
    consent?: unknown;
  };
  if (payload.consent !== true) {
    return Response.json({ error: "Bevestig eerst dat u akkoord gaat" }, { status: 400 });
  }

  let signerName: string;
  let signatureDataUrl: string;
  try {
    signerName = safeSignerName(payload.signerName);
    signatureDataUrl = parseSignatureDataUrl(payload.signatureDataUrl).dataUrl;
  } catch (caught) {
    return Response.json(
      { error: caught instanceof Error ? caught.message : "De ondertekening is ongeldig" },
      { status: 400 },
    );
  }

  await ensureDatabase();
  const db = getDb();
  const tokenHash = await hashSigningToken(token);
  const [signing] = await db
    .select()
    .from(quoteSignatures)
    .where(eq(quoteSignatures.tokenHash, tokenHash))
    .limit(1);
  if (!signing || signing.status === "revoked") return unavailable();
  if (signing.status === "accepted") {
    return Response.json({ status: "accepted", acceptedAt: signing.acceptedAt });
  }
  if (new Date(signing.expiresAt) < new Date()) {
    return Response.json({ error: "Deze offertelink is verlopen" }, { status: 410 });
  }

  const acceptedAt = new Date().toISOString();
  const [accepted] = await db
    .update(quoteSignatures)
    .set({
      status: "accepted",
      signerName,
      signatureDataUrl,
      acceptedAt,
      acceptedIp: clientIp(request),
      acceptedUserAgent: (request.headers.get("user-agent") || "").slice(0, 500),
      updatedAt: acceptedAt,
    })
    .where(
      and(
        eq(quoteSignatures.id, signing.id),
        eq(quoteSignatures.status, "pending"),
      ),
    )
    .returning();
  if (!accepted) {
    return Response.json(
      { error: "De offerte werd intussen verwerkt. Vernieuw de pagina." },
      { status: 409 },
    );
  }

  await db
    .update(workItems)
    .set({ status: "signed", updatedAt: acceptedAt })
    .where(
      and(
        eq(workItems.id, signing.workItemId),
        eq(workItems.organizationId, signing.organizationId),
      ),
    );
  await db.insert(auditEvents).values({
    organizationId: signing.organizationId,
    workItemId: signing.workItemId,
    actor: signing.customerEmail,
    action: "quote_signed",
    details: `Offerte aanvaard door ${signerName}; document ${signing.quoteHash.slice(0, 16)}`,
  });

  // The acceptance is already safely stored. A temporary mail failure must
  // never undo or duplicate the customer's signature.
  try {
    await sendSignedConfirmation(signing, {
      signerName,
      acceptedAt,
      customerEmail: signing.customerEmail,
      quoteHash: signing.quoteHash,
      signatureDataUrl,
    });
  } catch (caught) {
    console.error(
      JSON.stringify({
        event: "signed_quote_confirmation_failed",
        workItemId: signing.workItemId,
        error: caught instanceof Error ? caught.message : "Unknown mail error",
      }),
    );
  }

  return Response.json({ status: "accepted", acceptedAt });
}

async function sendSignedConfirmation(
  signing: typeof quoteSignatures.$inferSelect,
  acceptance: QuoteAcceptance,
) {
  const db = getDb();
  const [item, availableIntegrations] = await Promise.all([
    db
      .select()
      .from(workItems)
      .where(
        and(
          eq(workItems.id, signing.workItemId),
          eq(workItems.organizationId, signing.organizationId),
        ),
      )
      .limit(1)
      .then((rows) => rows[0]),
    db
      .select()
      .from(integrations)
      .where(eq(integrations.organizationId, signing.organizationId)),
  ]);
  if (!item) return;
  const integration = availableIntegrations
    .filter((entry) => entry.status === "connected")
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0];
  if (!integration) return;
  const builder = normalizeQuoteBuilder(JSON.parse(signing.quoteSnapshotJson));
  const attachment = {
    filename: `${safeFilename(builder.quoteNumber)}-ondertekend.pdf`,
    contentType: "application/pdf",
    bytes: await generateQuotePdf(builder, acceptance),
  };
  const outbound = {
    customerEmail: signing.customerEmail,
    customerName: signing.customerName,
    sourceSubject: item.sourceSubject,
    providerThreadId: item.providerThreadId,
    subjectOverride: `${builder.quoteNumber} - bevestiging van uw aanvaarding`,
    draft:
      `Beste ${signerNameForGreeting(signing.customerName)},\n\n` +
      `Bedankt voor uw akkoord met offerte ${builder.quoteNumber}. ` +
      "In bijlage vindt u de ondertekende versie voor uw administratie.\n\n" +
      `Met vriendelijke groeten,\n${builder.companyName}`,
    attachment,
  };
  if (integration.provider === "imap_smtp") {
    await sendSmtpWorkItemEmail(integration, outbound);
  } else if (integration.provider === "gmail") {
    await sendWorkItemEmail(integration, outbound);
  }
}

function clientIp(request: Request) {
  return (
    request.headers.get("cf-connecting-ip") ||
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    ""
  ).slice(0, 80);
}

function signerNameForGreeting(value: string) {
  return value.trim().split(/\s+/)[0] || "klant";
}

function safeFilename(value: string) {
  return value.normalize("NFKD").replace(/[^\w.-]+/g, "-").replace(/-+/g, "-").slice(0, 100);
}

function unavailable() {
  return Response.json({ error: "Offerte niet gevonden" }, { status: 404 });
}
