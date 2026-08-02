export type QuoteLine = {
  id: string;
  description: string;
  quantity: number;
  unit: string;
  unitPriceCents: number;
  vatRate: number;
};

export type QuoteBuilder = {
  version: 1;
  quoteNumber: string;
  issueDate: string;
  validUntil: string;
  companyName: string;
  companyAddress: string;
  companyVatNumber: string;
  companyEmail: string;
  customerName: string;
  customerEmail: string;
  customerAddress: string;
  title: string;
  introduction: string;
  lines: QuoteLine[];
  notes: string;
  paymentTerms: string;
};

export type QuoteTotals = {
  subtotalCents: number;
  vatCents: number;
  totalCents: number;
  vatGroups: { rate: number; baseCents: number; vatCents: number }[];
};

const allowedVatRates = new Set([0, 6, 12, 21]);
const isoDate = /^\d{4}-\d{2}-\d{2}$/;

export function normalizeQuoteBuilder(value: unknown): QuoteBuilder {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("De offertegegevens ontbreken");
  }
  const input = value as Record<string, unknown>;
  if (!Array.isArray(input.lines) || input.lines.length === 0) {
    throw new Error("Voeg minstens één offerteregel toe");
  }
  if (input.lines.length > 50) {
    throw new Error("Een offerte kan maximaal 50 regels bevatten");
  }

  const builder: QuoteBuilder = {
    version: 1,
    quoteNumber: requiredText(input.quoteNumber, "Offertenummer", 60),
    issueDate: requiredDate(input.issueDate, "Offertedatum"),
    validUntil: requiredDate(input.validUntil, "Geldig tot"),
    companyName: requiredText(input.companyName, "Bedrijfsnaam", 140),
    companyAddress: optionalText(input.companyAddress, 300),
    companyVatNumber: optionalText(input.companyVatNumber, 60),
    companyEmail: optionalEmail(input.companyEmail),
    customerName: requiredText(input.customerName, "Klantnaam", 140),
    customerEmail: requiredEmail(input.customerEmail, "E-mailadres klant"),
    customerAddress: requiredText(input.customerAddress, "Klantadres", 300),
    title: requiredText(input.title, "Offertetitel", 180),
    introduction: optionalText(input.introduction, 1500),
    lines: input.lines.map((line, index) => normalizeLine(line, index)),
    notes: optionalText(input.notes, 2000),
    paymentTerms: optionalText(input.paymentTerms, 1000),
  };
  if (builder.validUntil < builder.issueDate) {
    throw new Error("De geldigheidsdatum kan niet vóór de offertedatum liggen");
  }
  return builder;
}

export function quoteTotals(builder: QuoteBuilder): QuoteTotals {
  const grouped = new Map<number, { baseCents: number; vatCents: number }>();
  let subtotalCents = 0;
  for (const line of builder.lines) {
    const baseCents = Math.round(line.quantity * line.unitPriceCents);
    const vatCents = Math.round((baseCents * line.vatRate) / 100);
    subtotalCents += baseCents;
    const current = grouped.get(line.vatRate) || {
      baseCents: 0,
      vatCents: 0,
    };
    current.baseCents += baseCents;
    current.vatCents += vatCents;
    grouped.set(line.vatRate, current);
  }
  const vatGroups = [...grouped.entries()]
    .sort(([left], [right]) => left - right)
    .map(([rate, values]) => ({ rate, ...values }));
  const vatCents = vatGroups.reduce((sum, group) => sum + group.vatCents, 0);
  return {
    subtotalCents,
    vatCents,
    totalCents: subtotalCents + vatCents,
    vatGroups,
  };
}

export function quoteValidationIssues(builder: QuoteBuilder) {
  const issues: string[] = [];
  if (!builder.companyAddress.trim()) issues.push("Vul het bedrijfsadres in");
  if (!builder.companyVatNumber.trim()) issues.push("Vul het btw-nummer in");
  if (!builder.companyEmail.trim()) issues.push("Vul het bedrijfs-e-mailadres in");
  if (!builder.customerAddress.trim()) issues.push("Vul het klantadres in");
  if (builder.lines.some((line) => !line.description.trim())) {
    issues.push("Elke offerteregel heeft een omschrijving nodig");
  }
  if (builder.lines.some((line) => line.quantity <= 0)) {
    issues.push("Elke offerteregel heeft een hoeveelheid groter dan nul nodig");
  }
  if (quoteTotals(builder).totalCents <= 0) {
    issues.push("Vul minstens één bedrag groter dan nul in");
  }
  return issues;
}

export function quoteIsSendable(builder: QuoteBuilder) {
  return quoteValidationIssues(builder).length === 0;
}

export function formatEuro(cents: number) {
  return new Intl.NumberFormat("nl-BE", {
    style: "currency",
    currency: "EUR",
  }).format(cents / 100);
}

function normalizeLine(value: unknown, index: number): QuoteLine {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`Offerteregel ${index + 1} is ongeldig`);
  }
  const line = value as Record<string, unknown>;
  const quantity = numericValue(line.quantity, `Hoeveelheid regel ${index + 1}`);
  const unitPriceCents = integerValue(
    line.unitPriceCents,
    `Eenheidsprijs regel ${index + 1}`,
  );
  const vatRate = numericValue(line.vatRate, `Btw regel ${index + 1}`);
  if (quantity <= 0 || quantity > 100_000) {
    throw new Error(`Hoeveelheid regel ${index + 1} is ongeldig`);
  }
  if (unitPriceCents < 0 || unitPriceCents > 1_000_000_000) {
    throw new Error(`Eenheidsprijs regel ${index + 1} is ongeldig`);
  }
  if (!allowedVatRates.has(vatRate)) {
    throw new Error(`Kies 0%, 6%, 12% of 21% btw voor regel ${index + 1}`);
  }
  return {
    id: optionalText(line.id, 80) || `line_${index + 1}`,
    description: requiredText(
      line.description,
      `Omschrijving regel ${index + 1}`,
      500,
    ),
    quantity: Math.round(quantity * 1000) / 1000,
    unit: requiredText(line.unit, `Eenheid regel ${index + 1}`, 40),
    unitPriceCents,
    vatRate,
  };
}

function requiredText(value: unknown, label: string, maxLength: number) {
  const result = optionalText(value, maxLength);
  if (!result) throw new Error(`${label} is verplicht`);
  return result;
}

function optionalText(value: unknown, maxLength: number) {
  if (typeof value !== "string") return "";
  return value.trim().slice(0, maxLength);
}

function requiredDate(value: unknown, label: string) {
  if (typeof value !== "string" || !isoDate.test(value)) {
    throw new Error(`${label} is ongeldig`);
  }
  return value;
}

function requiredEmail(value: unknown, label: string) {
  const email = optionalEmail(value);
  if (!email) throw new Error(`${label} is ongeldig`);
  return email;
}

function optionalEmail(value: unknown) {
  if (typeof value !== "string") return "";
  const email = value.trim().toLowerCase().slice(0, 254);
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : "";
}

function numericValue(value: unknown, label: string) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`${label} is ongeldig`);
  }
  return value;
}

function integerValue(value: unknown, label: string) {
  const number = numericValue(value, label);
  if (!Number.isInteger(number)) throw new Error(`${label} is ongeldig`);
  return number;
}
