import { eq } from "drizzle-orm";
import { ensureDatabase, getDb } from "../../../../../db";
import { quoteSignatures } from "../../../../../db/schema";
import { normalizeQuoteBuilder } from "../../../../../lib/quote-builder";
import { generateQuotePdf } from "../../../../../lib/quote-pdf";
import { hashSigningToken, type QuoteAcceptance } from "../../../../../lib/quote-signing";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;
  if (token.length < 20 || token.length > 120) return unavailable();
  await ensureDatabase();
  const [signing] = await getDb()
    .select()
    .from(quoteSignatures)
    .where(eq(quoteSignatures.tokenHash, await hashSigningToken(token)))
    .limit(1);
  if (!signing || signing.status === "revoked") return unavailable();
  if (signing.status === "pending" && new Date(signing.expiresAt) < new Date()) {
    return Response.json({ error: "Deze offertelink is verlopen" }, { status: 410 });
  }
  try {
    const builder = normalizeQuoteBuilder(JSON.parse(signing.quoteSnapshotJson));
    const acceptance: QuoteAcceptance | undefined =
      signing.status === "accepted" && signing.signerName && signing.acceptedAt && signing.signatureDataUrl
        ? {
            signerName: signing.signerName,
            acceptedAt: signing.acceptedAt,
            customerEmail: signing.customerEmail,
            quoteHash: signing.quoteHash,
            signatureDataUrl: signing.signatureDataUrl,
          }
        : undefined;
    const pdf = await generateQuotePdf(builder, acceptance);
    const filename = safeFilename(`${builder.quoteNumber}-${acceptance ? "ondertekend" : "offerte"}.pdf`);
    return new Response(new Uint8Array(pdf).buffer, {
      headers: {
        "cache-control": "private, no-store",
        "content-disposition": `inline; filename="${filename}"`,
        "content-type": "application/pdf",
        "x-content-type-options": "nosniff",
      },
    });
  } catch {
    return Response.json({ error: "De offerte-PDF kon niet worden opgebouwd" }, { status: 409 });
  }
}

function unavailable() {
  return Response.json({ error: "Offerte niet gevonden" }, { status: 404 });
}

function safeFilename(value: string) {
  return value.normalize("NFKD").replace(/[^\w.-]+/g, "-").replace(/-+/g, "-").slice(0, 120);
}
