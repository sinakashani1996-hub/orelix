import {
  PDFDocument,
  StandardFonts,
  rgb,
  type PDFFont,
  type PDFPage,
} from "pdf-lib";
import {
  formatEuro,
  quoteTotals,
  type QuoteBuilder,
  type QuoteLine,
} from "./quote-builder";

const pageWidth = 595.28;
const pageHeight = 841.89;
const margin = 48;
const green = rgb(0.075, 0.22, 0.18);
const mint = rgb(0.74, 0.94, 0.83);
const ink = rgb(0.12, 0.17, 0.15);
const muted = rgb(0.38, 0.44, 0.41);
const lineColor = rgb(0.86, 0.89, 0.87);
const soft = rgb(0.96, 0.98, 0.96);

export async function generateQuotePdf(builder: QuoteBuilder) {
  const document = await PDFDocument.create();
  const regular = await document.embedFont(StandardFonts.Helvetica);
  const bold = await document.embedFont(StandardFonts.HelveticaBold);
  const context = { document, regular, bold, page: document.addPage([pageWidth, pageHeight]), y: 0 };

  drawHeader(context, builder);
  drawParties(context, builder);
  drawIntroduction(context, builder);
  drawLines(context, builder.lines);
  drawTotals(context, builder);
  drawTerms(context, builder);
  drawFooters(document.getPages(), regular, builder.quoteNumber);

  document.setTitle(`${builder.quoteNumber} - ${builder.customerName}`);
  document.setAuthor(builder.companyName);
  document.setSubject(builder.title);
  document.setCreator("Orelix Office");
  document.setProducer("Orelix Office");
  return document.save();
}

type Context = {
  document: PDFDocument;
  regular: PDFFont;
  bold: PDFFont;
  page: PDFPage;
  y: number;
};

function drawHeader(context: Context, builder: QuoteBuilder) {
  const { page, bold, regular } = context;
  page.drawRectangle({
    x: 0,
    y: pageHeight - 150,
    width: pageWidth,
    height: 150,
    color: green,
  });
  page.drawRectangle({
    x: margin,
    y: pageHeight - 76,
    width: 30,
    height: 30,
    color: mint,
  });
  page.drawText("O", {
    x: margin + 9,
    y: pageHeight - 67,
    size: 14,
    font: bold,
    color: green,
  });
  page.drawText("ORELIX OFFICE", {
    x: margin + 42,
    y: pageHeight - 61,
    size: 13,
    font: bold,
    color: rgb(1, 1, 1),
  });
  page.drawText(builder.companyName, {
    x: margin + 42,
    y: pageHeight - 77,
    size: 8.5,
    font: regular,
    color: rgb(0.76, 0.86, 0.81),
  });
  page.drawText("OFFERTE", {
    x: pageWidth - margin - 116,
    y: pageHeight - 64,
    size: 22,
    font: bold,
    color: rgb(1, 1, 1),
  });
  drawRightText(page, builder.quoteNumber, pageWidth - margin, pageHeight - 84, 9, bold, mint);
  context.y = pageHeight - 181;
}

function drawParties(context: Context, builder: QuoteBuilder) {
  const { page, regular, bold } = context;
  const columnWidth = (pageWidth - margin * 2 - 18) / 2;
  drawPartyCard(
    page,
    margin,
    context.y - 112,
    columnWidth,
    112,
    "VAN",
    [
      builder.companyName,
      builder.companyAddress,
      builder.companyVatNumber ? `BTW ${builder.companyVatNumber}` : "",
      builder.companyEmail,
    ],
    regular,
    bold,
  );
  drawPartyCard(
    page,
    margin + columnWidth + 18,
    context.y - 112,
    columnWidth,
    112,
    "VOOR",
    [builder.customerName, builder.customerAddress, builder.customerEmail],
    regular,
    bold,
  );
  context.y -= 136;
  page.drawText("Offertedatum", {
    x: margin,
    y: context.y,
    size: 8,
    font: regular,
    color: muted,
  });
  page.drawText(formatDate(builder.issueDate), {
    x: margin + 68,
    y: context.y,
    size: 8.5,
    font: bold,
    color: ink,
  });
  page.drawText("Geldig tot", {
    x: margin + 190,
    y: context.y,
    size: 8,
    font: regular,
    color: muted,
  });
  page.drawText(formatDate(builder.validUntil), {
    x: margin + 244,
    y: context.y,
    size: 8.5,
    font: bold,
    color: ink,
  });
  context.y -= 35;
}

function drawIntroduction(context: Context, builder: QuoteBuilder) {
  const { page, regular, bold } = context;
  page.drawText(builder.title, {
    x: margin,
    y: context.y,
    size: 17,
    font: bold,
    color: ink,
  });
  context.y -= 22;
  const lines = wrapText(
    builder.introduction || `Beste ${builder.customerName}, hierbij bezorgen wij u ons voorstel.`,
    regular,
    9.5,
    pageWidth - margin * 2,
  );
  for (const line of lines.slice(0, 8)) {
    page.drawText(line, {
      x: margin,
      y: context.y,
      size: 9.5,
      font: regular,
      color: muted,
    });
    context.y -= 14;
  }
  context.y -= 16;
}

function drawLines(context: Context, lines: QuoteLine[]) {
  drawTableHeader(context);
  for (const line of lines) {
    const descriptionLines = wrapText(line.description, context.regular, 8.5, 226);
    const rowHeight = Math.max(31, descriptionLines.length * 11 + 14);
    if (context.y - rowHeight < 185) {
      context.page = context.document.addPage([pageWidth, pageHeight]);
      context.y = pageHeight - 62;
      drawTableHeader(context);
    }
    const top = context.y;
    context.page.drawRectangle({
      x: margin,
      y: top - rowHeight,
      width: pageWidth - margin * 2,
      height: rowHeight,
      color: rgb(1, 1, 1),
      borderColor: lineColor,
      borderWidth: 0.6,
    });
    descriptionLines.forEach((text, index) => {
      context.page.drawText(text, {
        x: margin + 9,
        y: top - 18 - index * 11,
        size: 8.5,
        font: context.regular,
        color: ink,
      });
    });
    drawRightText(context.page, formatQuantity(line.quantity), 348, top - 18, 8.2, context.regular, ink);
    context.page.drawText(line.unit, {
      x: 360,
      y: top - 18,
      size: 8.2,
      font: context.regular,
      color: muted,
    });
    drawRightText(context.page, formatEuro(line.unitPriceCents), 458, top - 18, 8.2, context.regular, ink);
    drawRightText(context.page, `${line.vatRate}%`, 498, top - 18, 8.2, context.regular, muted);
    drawRightText(
      context.page,
      formatEuro(Math.round(line.quantity * line.unitPriceCents)),
      pageWidth - margin - 8,
      top - 18,
      8.2,
      context.bold,
      ink,
    );
    context.y -= rowHeight;
  }
  context.y -= 16;
}

function drawTableHeader(context: Context) {
  const { page, bold } = context;
  page.drawRectangle({
    x: margin,
    y: context.y - 24,
    width: pageWidth - margin * 2,
    height: 24,
    color: green,
  });
  const labels = [
    ["OMSCHRIJVING", margin + 9],
    ["AANTAL", 315],
    ["EENHEID", 360],
    ["PRIJS", 427],
    ["BTW", 474],
    ["TOTAAL", 515],
  ] as const;
  labels.forEach(([label, x]) =>
    page.drawText(label, {
      x,
      y: context.y - 16,
      size: 6.6,
      font: bold,
      color: rgb(0.91, 0.97, 0.94),
    }),
  );
  context.y -= 24;
}

function drawTotals(context: Context, builder: QuoteBuilder) {
  const totals = quoteTotals(builder);
  const x = pageWidth - margin - 205;
  const width = 205;
  const rows = [
    ["Subtotaal", formatEuro(totals.subtotalCents)],
    ...totals.vatGroups.map((group) => [
      `BTW ${group.rate}%`,
      formatEuro(group.vatCents),
    ]),
  ];
  const needed = rows.length * 18 + 44;
  if (context.y - needed < 135) {
    context.page = context.document.addPage([pageWidth, pageHeight]);
    context.y = pageHeight - 62;
  }
  rows.forEach(([label, value]) => {
    context.page.drawText(label, {
      x,
      y: context.y,
      size: 8.5,
      font: context.regular,
      color: muted,
    });
    drawRightText(context.page, value, x + width, context.y, 8.5, context.regular, ink);
    context.y -= 18;
  });
  context.page.drawLine({
    start: { x, y: context.y + 8 },
    end: { x: x + width, y: context.y + 8 },
    thickness: 1,
    color: green,
  });
  context.page.drawText("Totaal incl. btw", {
    x,
    y: context.y - 7,
    size: 10,
    font: context.bold,
    color: green,
  });
  drawRightText(
    context.page,
    formatEuro(totals.totalCents),
    x + width,
    context.y - 7,
    12,
    context.bold,
    green,
  );
  context.y -= 43;
}

function drawTerms(context: Context, builder: QuoteBuilder) {
  const sections = [
    ["OPMERKINGEN", builder.notes],
    ["BETALINGSVOORWAARDEN", builder.paymentTerms],
  ].filter(([, value]) => value.trim());
  for (const [label, value] of sections) {
    const lines = wrapText(value, context.regular, 8.2, pageWidth - margin * 2 - 20);
    const height = lines.length * 11 + 35;
    if (context.y - height < 55) {
      context.page = context.document.addPage([pageWidth, pageHeight]);
      context.y = pageHeight - 62;
    }
    context.page.drawRectangle({
      x: margin,
      y: context.y - height,
      width: pageWidth - margin * 2,
      height,
      color: soft,
      borderColor: lineColor,
      borderWidth: 0.6,
    });
    context.page.drawText(label, {
      x: margin + 10,
      y: context.y - 16,
      size: 6.8,
      font: context.bold,
      color: green,
    });
    lines.forEach((line, index) =>
      context.page.drawText(line, {
        x: margin + 10,
        y: context.y - 31 - index * 11,
        size: 8.2,
        font: context.regular,
        color: muted,
      }),
    );
    context.y -= height + 10;
  }
}

function drawFooters(pages: PDFPage[], font: PDFFont, quoteNumber: string) {
  pages.forEach((page, index) => {
    page.drawLine({
      start: { x: margin, y: 34 },
      end: { x: pageWidth - margin, y: 34 },
      thickness: 0.6,
      color: lineColor,
    });
    page.drawText(`${quoteNumber}  |  Gegenereerd met Orelix Office`, {
      x: margin,
      y: 21,
      size: 6.8,
      font,
      color: muted,
    });
    drawRightText(page, `${index + 1} / ${pages.length}`, pageWidth - margin, 21, 6.8, font, muted);
  });
}

function drawPartyCard(
  page: PDFPage,
  x: number,
  y: number,
  width: number,
  height: number,
  label: string,
  values: string[],
  regular: PDFFont,
  bold: PDFFont,
) {
  page.drawRectangle({
    x,
    y,
    width,
    height,
    color: soft,
    borderColor: lineColor,
    borderWidth: 0.6,
  });
  page.drawText(label, {
    x: x + 12,
    y: y + height - 19,
    size: 6.8,
    font: bold,
    color: green,
  });
  let textY = y + height - 37;
  values.filter(Boolean).forEach((value, index) => {
    wrapText(value, index === 0 ? bold : regular, index === 0 ? 9 : 8, width - 24)
      .slice(0, index === 1 ? 2 : 1)
      .forEach((line) => {
        page.drawText(line, {
          x: x + 12,
          y: textY,
          size: index === 0 ? 9 : 8,
          font: index === 0 ? bold : regular,
          color: index === 0 ? ink : muted,
        });
        textY -= 12;
      });
  });
}

function wrapText(text: string, font: PDFFont, size: number, maxWidth: number) {
  const paragraphs = String(text || "").replace(/\r/g, "").split("\n");
  const lines: string[] = [];
  for (const paragraph of paragraphs) {
    if (!paragraph.trim()) {
      lines.push("");
      continue;
    }
    const words = paragraph.trim().split(/\s+/);
    let current = "";
    for (const word of words) {
      const candidate = current ? `${current} ${word}` : word;
      if (font.widthOfTextAtSize(candidate, size) <= maxWidth || !current) {
        current = candidate;
      } else {
        lines.push(current);
        current = word;
      }
    }
    if (current) lines.push(current);
  }
  return lines;
}

function drawRightText(
  page: PDFPage,
  text: string,
  right: number,
  y: number,
  size: number,
  font: PDFFont,
  color: ReturnType<typeof rgb>,
) {
  page.drawText(text, {
    x: right - font.widthOfTextAtSize(text, size),
    y,
    size,
    font,
    color,
  });
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("nl-BE", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${value}T00:00:00.000Z`));
}

function formatQuantity(value: number) {
  return new Intl.NumberFormat("nl-BE", {
    maximumFractionDigits: 3,
  }).format(value);
}
