export type QuoteNumberingMode = "automatic" | "manual";

export type QuoteNumberingSettings = {
  mode: QuoteNumberingMode;
  prefix: string;
  nextNumber: number;
  startNumber: number;
  resetYearly: boolean;
  year: number | null;
};

export function normalizeQuoteNumberingSettings(value: Partial<QuoteNumberingSettings>): QuoteNumberingSettings {
  return {
    mode: value.mode === "manual" ? "manual" : "automatic",
    prefix: normalizePrefix(value.prefix),
    nextNumber: normalizeNextNumber(value.nextNumber),
    startNumber: normalizeNextNumber(value.startNumber),
    resetYearly: value.resetYearly !== false,
    year: typeof value.year === "number" && Number.isInteger(value.year) ? value.year : null,
  };
}

export function normalizePrefix(value: unknown) {
  const prefix = typeof value === "string" ? value.trim().toUpperCase() : "";
  return (prefix || "OFF").replace(/[^A-Z0-9-]/g, "").slice(0, 18) || "OFF";
}

export function normalizeNextNumber(value: unknown) {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isInteger(parsed) && parsed >= 1 && parsed <= 9_999_999 ? parsed : 1;
}

export function formatQuoteNumber(settings: Pick<QuoteNumberingSettings, "prefix" | "nextNumber" | "resetYearly">, year = new Date().getFullYear()) {
  const prefix = normalizePrefix(settings.prefix);
  const sequence = String(normalizeNextNumber(settings.nextNumber)).padStart(4, "0");
  return settings.resetYearly ? `${prefix}-${year}-${sequence}` : `${prefix}-${sequence}`;
}
