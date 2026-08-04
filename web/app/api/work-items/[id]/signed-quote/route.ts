import { and, desc, eq } from "drizzle-orm";
import { ensureDatabase, getDb } from "../../../../../db";
import { quoteSignatures, workItems } from "../../../../../db/schema";
import { getAppContext } from "../../../../../lib/context";
import { normalizeQuoteBuilder } from "../../../../../lib/quote-builder";
import { generateQuotePdf } from "../../../../../lib/quote-pdf";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const context = await getAppContext();
  if (!context?.organization) {
    return Response.json({ error: "Niet aangemeld" }, { status: 401 });
  }
  await ensureDatabase();
  const { id } = await params;
  const db = getDb();
  const [item] = await db
    .select({ id: workItems.id })
    .from(workItems)
    .where(
      and(
        eq(workItems.id, id),
        eq(workItems.organizationId, context.organization.id),
      ),
    )
    .limit(1);
  if (!item) return Response.json({ error: "Dossier niet gevonden" }, { status: 404 });
  const [signing] = await db
    .select()
    .from(quoteSignatures)
    .where(
      and(
        eq(quoteSignatures.organizationId, context.organization.id),
        eq(quoteSignatures.workItemId, id),
        eq(quoteSignatures.status, "accepted"),
      ),
    )
    .orderBy(desc(quoteSignatures.acceptedAt))
    .limit(1);
  if (!signing || !signing.signerName || !signing.acceptedAt || !signing.signatureDataUrl) {
    return Response.json({ error: "Deze offerte is nog niet ondertekend" }, { status: 409 });
  }
  const builder = normalizeQuoteBuilder(JSON.parse(signing.quoteSnapshotJson));
  const pdf = await generateQuotePdf(builder, {
    signerName: signing.signerName,
    acceptedAt: signing.acceptedAt,
    customerEmail: signing.customerEmail,
    quoteHash: signing.quoteHash,
    signatureDataUrl: signing.signatureDataUrl,
  });
  const filename = safeFilename(`${builder.quoteNumber}-ondertekend.pdf`);
  return new Response(new Uint8Array(pdf).buffer, {
    headers: {
      "cache-control": "private, no-store",
      "content-disposition": `inline; filename="${filename}"`,
      "content-type": "application/pdf",
      "x-content-type-options": "nosniff",
    },
  });
}

function safeFilename(value: string) {
  return value.normalize("NFKD").replace(/[^\w.-]+/g, "-").replace(/-+/g, "-").slice(0, 120);
}
