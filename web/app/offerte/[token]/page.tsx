import { eq } from "drizzle-orm";
import { ensureDatabase, getDb } from "../../../db";
import { quoteSignatures } from "../../../db/schema";
import { normalizeQuoteBuilder, quoteTotals, formatEuro } from "../../../lib/quote-builder";
import { hashSigningToken } from "../../../lib/quote-signing";
import { QuoteAcceptanceForm } from "./quote-acceptance-form";

export default async function PublicQuotePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const signing = await findSigningRequest(token);
  if (!signing) return <UnavailableQuote title="Deze offertelink is niet geldig" />;

  let builder;
  try {
    builder = normalizeQuoteBuilder(JSON.parse(signing.quoteSnapshotJson));
  } catch {
    return <UnavailableQuote title="Deze offerte kon niet worden geopend" />;
  }
  const expired = signing.status === "pending" && new Date(signing.expiresAt) < new Date();
  if (signing.status === "revoked" || expired) {
    return (
      <UnavailableQuote
        title="Deze offertelink is verlopen"
        text="Vraag de afzender om een nieuwe offerte-uitnodiging."
      />
    );
  }
  const accepted = signing.status === "accepted";
  const totals = quoteTotals(builder);

  return (
    <main className="public-quote-shell">
      <header className="public-quote-header">
        <span className="public-quote-logo">O</span>
        <div>
          <strong>Orelix Office</strong>
          <span>Veilige offerte</span>
        </div>
      </header>
      <section className="public-quote-intro">
        <div>
          <p className="eyebrow">{accepted ? "OFFERTE AANVAARD" : "OFFERTE TER GOEDKEURING"}</p>
          <h1>{builder.title}</h1>
          <p>
            {builder.quoteNumber} van {builder.companyName} voor {builder.customerName}
          </p>
        </div>
        <div className="public-quote-total">
          <span>Totaal incl. btw</span>
          <strong>{formatEuro(totals.totalCents)}</strong>
        </div>
      </section>
      <section className="public-quote-grid">
        <div className="public-quote-document">
          <iframe
            title={`Offerte ${builder.quoteNumber}`}
            src={`/api/quotes/${encodeURIComponent(token)}/pdf`}
          />
          <a href={`/api/quotes/${encodeURIComponent(token)}/pdf`} target="_blank" rel="noreferrer">
            PDF in nieuw venster openen
          </a>
        </div>
        <QuoteAcceptanceForm
          token={token}
          customerName={builder.customerName}
          accepted={accepted}
          signerName={signing.signerName || ""}
          acceptedAt={signing.acceptedAt || ""}
        />
      </section>
    </main>
  );
}

async function findSigningRequest(token: string) {
  if (token.length < 20 || token.length > 120) return null;
  await ensureDatabase();
  const signing = (
    await getDb()
      .select()
      .from(quoteSignatures)
      .where(eq(quoteSignatures.tokenHash, await hashSigningToken(token)))
      .limit(1)
  )[0];
  if (signing?.status === "pending" && !signing.viewedAt) {
    const viewedAt = new Date().toISOString();
    await getDb()
      .update(quoteSignatures)
      .set({ viewedAt, updatedAt: viewedAt })
      .where(eq(quoteSignatures.id, signing.id));
    return { ...signing, viewedAt };
  }
  return signing;
}

function UnavailableQuote({ title, text }: { title: string; text?: string }) {
  return (
    <main className="public-quote-unavailable">
      <span className="public-quote-logo">O</span>
      <h1>{title}</h1>
      <p>{text || "Controleer de link in de e-mail of neem contact op met de afzender."}</p>
    </main>
  );
}
