import { and, eq } from "drizzle-orm";
import { getDb } from "../../../../../db";
import { workItems } from "../../../../../db/schema";
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

  const { id } = await params;
  const db = getDb();
  const [item] = await db
    .select({
      quoteJson: workItems.quoteJson,
      moduleId: workItems.moduleId,
    })
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
  if (item.moduleId !== "quote_assistant") {
    return Response.json(
      { error: "Dit dossier bevat geen offerte" },
      { status: 409 },
    );
  }

  try {
    const stored = JSON.parse(item.quoteJson) as { builder?: unknown };
    const builder = normalizeQuoteBuilder(stored.builder);
    const pdf = await generateQuotePdf(builder);
    const body = new Uint8Array(pdf).buffer;
    const filename = safeFilename(`${builder.quoteNumber}-${builder.customerName}.pdf`);
    return new Response(body, {
      headers: {
        "cache-control": "private, no-store",
        "content-disposition": `inline; filename="${filename}"`,
        "content-type": "application/pdf",
      },
    });
  } catch (caught) {
    return Response.json(
      {
        error:
          caught instanceof Error
            ? caught.message
            : "De offerte-PDF kon niet worden opgebouwd",
      },
      { status: 409 },
    );
  }
}

function safeFilename(value: string) {
  return value
    .normalize("NFKD")
    .replace(/[^\w.-]+/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 120);
}
