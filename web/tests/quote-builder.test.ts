import assert from "node:assert/strict";
import test from "node:test";
import { PDFDocument } from "pdf-lib";
import { buildGmailRawMessage } from "../lib/gmail-message";
import {
  normalizeQuoteBuilder,
  quoteIsSendable,
  quoteTotals,
  quoteValidationIssues,
  type QuoteBuilder,
} from "../lib/quote-builder";
import { generateQuotePdf } from "../lib/quote-pdf";

const completeQuote: QuoteBuilder = {
  version: 1,
  quoteNumber: "OFF-2026-0001",
  issueDate: "2026-07-24",
  validUntil: "2026-08-23",
  companyName: "First Client BV",
  companyAddress: "Teststraat 1, 2000 Antwerpen",
  companyVatNumber: "BE 0123.456.789",
  companyEmail: "info@firstclient.be",
  customerName: "Isis Janssens",
  customerEmail: "isis@example.com",
  customerAddress: "Oude Mechelsbaan 189, 2800 Mechelen",
  title: "Offerte zonnepanelen",
  introduction: "Voorstel voor de levering en installatie.",
  lines: [
    {
      id: "panels",
      description: "Levering en installatie van 10 zonnepanelen",
      quantity: 10,
      unit: "stuk",
      unitPriceCents: 45_000,
      vatRate: 6,
    },
    {
      id: "inverter",
      description: "Omvormer en indienststelling",
      quantity: 1,
      unit: "project",
      unitPriceCents: 120_000,
      vatRate: 21,
    },
  ],
  notes: "Definitieve uitvoering na technische controle.",
  paymentTerms: "30% bij bestelling, saldo na oplevering.",
};

test("calculates quote totals and VAT deterministically", () => {
  const quote = normalizeQuoteBuilder(completeQuote);
  const totals = quoteTotals(quote);
  assert.equal(totals.subtotalCents, 570_000);
  assert.equal(totals.vatCents, 52_200);
  assert.equal(totals.totalCents, 622_200);
  assert.equal(quoteIsSendable(quote), true);
  assert.deepEqual(quoteValidationIssues(quote), []);
});

test("blocks an incomplete quote from sending", () => {
  const quote = normalizeQuoteBuilder({
    ...completeQuote,
    companyVatNumber: "",
    lines: [{ ...completeQuote.lines[0], unitPriceCents: 0 }],
  });
  assert.equal(quoteIsSendable(quote), false);
  assert.match(quoteValidationIssues(quote).join(" "), /btw-nummer/i);
  assert.match(quoteValidationIssues(quote).join(" "), /bedrag/i);
});

test("generates a readable PDF and Gmail attachment", async () => {
  const bytes = await generateQuotePdf(completeQuote);
  assert.equal(new TextDecoder().decode(bytes.slice(0, 4)), "%PDF");
  const document = await PDFDocument.load(bytes);
  assert.ok(document.getPageCount() >= 1);
  assert.equal(document.getTitle(), "OFF-2026-0001 - Isis Janssens");

  const raw = buildGmailRawMessage({
    customerEmail: completeQuote.customerEmail,
    customerName: completeQuote.customerName,
    sourceSubject: "Aanvraag zonnepanelen",
    draft: "Beste Isis,\n\nIn bijlage vindt u onze offerte.",
    providerThreadId: "thread-1",
    subjectOverride: "OFF-2026-0001 - Offerte zonnepanelen",
    attachment: {
      filename: "OFF-2026-0001.pdf",
      contentType: "application/pdf",
      bytes,
    },
  });
  assert.match(raw, /Content-Type: multipart\/mixed/);
  assert.match(raw, /Content-Type: application\/pdf/);
  assert.match(raw, /filename="OFF-2026-0001\.pdf"/);
  assert.match(raw, /JVBERi0/);
});
