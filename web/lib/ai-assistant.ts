import type { QuoteAnalysis } from "./quote-analyzer";

export type ConversationMessage = {
  role: "customer" | "assistant";
  subject?: string;
  body: string;
  at: string;
};

export type ExtractedQuoteData = {
  address: string;
  buildingOlderThan10Years: string;
  propertyType: string;
  annualUsageKwh: string;
  panelCount: string;
  roofType: string;
  batteryPreference: string;
  desiredTiming: string;
};

export type QuoteConcept = {
  title: string;
  introduction: string;
  scope: string[];
  assumptions: string[];
  validityDays: number;
};

export type SmartEmailAnalysis = QuoteAnalysis & {
  customerName: string;
  extracted: ExtractedQuoteData;
  missingFields: string[];
  quoteReady: boolean;
  quote: QuoteConcept;
  aiProvider: string;
};

const moduleIds = new Set([
  "quote_assistant",
  "service_assistant",
  "inbox_assistant",
]);
const kinds = new Set([
  "quote_request",
  "missing_information",
  "service_request",
  "manual",
]);
const statuses = new Set(["needs_approval", "draft_ready", "routed"]);

export async function analyzeConversationWithAI(input: {
  conversation: ConversationMessage[];
  knownData?: Partial<ExtractedQuoteData>;
  preferredModule?:
    | "quote_assistant"
    | "service_assistant"
    | "inbox_assistant";
}): Promise<SmartEmailAnalysis> {
  const serviceUrl = process.env.AI_SERVICE_URL;
  const sharedSecret = process.env.AI_SHARED_SECRET;
  if (!serviceUrl || !sharedSecret) {
    throw new Error("AI service is not configured");
  }

  const response = await fetch(
    new URL("/api/ai/analyze", serviceUrl).toString(),
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${sharedSecret}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(input),
      signal: AbortSignal.timeout(25_000),
    },
  );
  if (!response.ok) {
    throw new Error(`AI service failed with status ${response.status}`);
  }
  const payload = (await response.json()) as {
    analysis?: unknown;
    model?: string;
  };
  return validateAnalysis(payload.analysis, payload.model || "workers-ai");
}

export function validateAnalysis(
  value: unknown,
  aiProvider = "workers-ai",
): SmartEmailAnalysis {
  if (!value || typeof value !== "object") {
    throw new Error("AI response is not an object");
  }
  const item = value as Record<string, unknown>;
  if (
    !moduleIds.has(String(item.moduleId)) ||
    !kinds.has(String(item.kind)) ||
    !statuses.has(String(item.status)) ||
    typeof item.title !== "string" ||
    typeof item.summary !== "string" ||
    typeof item.draft !== "string" ||
    typeof item.customerName !== "string" ||
    typeof item.confidence !== "number" ||
    typeof item.quoteReady !== "boolean" ||
    !Array.isArray(item.missingFields)
  ) {
    throw new Error("AI response has an invalid shape");
  }

  const extracted = stringRecord(item.extracted, [
    "address",
    "buildingOlderThan10Years",
    "propertyType",
    "annualUsageKwh",
    "panelCount",
    "roofType",
    "batteryPreference",
    "desiredTiming",
  ]) as ExtractedQuoteData;
  const quoteValue = item.quote;
  if (!quoteValue || typeof quoteValue !== "object") {
    throw new Error("AI quote concept is missing");
  }
  const quoteRecord = quoteValue as Record<string, unknown>;
  if (
    typeof quoteRecord.title !== "string" ||
    typeof quoteRecord.introduction !== "string" ||
    !Array.isArray(quoteRecord.scope) ||
    !quoteRecord.scope.every((entry) => typeof entry === "string") ||
    !Array.isArray(quoteRecord.assumptions) ||
    !quoteRecord.assumptions.every((entry) => typeof entry === "string") ||
    typeof quoteRecord.validityDays !== "number"
  ) {
    throw new Error("AI quote concept has an invalid shape");
  }

  return {
    moduleId: item.moduleId as SmartEmailAnalysis["moduleId"],
    kind: item.kind as SmartEmailAnalysis["kind"],
    title: item.title,
    summary: item.summary,
    status: item.status as SmartEmailAnalysis["status"],
    confidence: Math.max(0, Math.min(100, Math.round(item.confidence))),
    customerName: item.customerName.trim() || "Klant",
    draft: item.draft.trim(),
    extracted,
    missingFields: item.missingFields.filter(
      (entry): entry is string => typeof entry === "string",
    ),
    quoteReady: item.quoteReady,
    quote: {
      title: quoteRecord.title,
      introduction: quoteRecord.introduction,
      scope: quoteRecord.scope as string[],
      assumptions: quoteRecord.assumptions as string[],
      validityDays: Math.max(
        1,
        Math.min(90, Math.round(quoteRecord.validityDays)),
      ),
    },
    aiProvider,
  };
}

function stringRecord(value: unknown, keys: string[]) {
  if (!value || typeof value !== "object") {
    throw new Error("AI extracted data is missing");
  }
  const source = value as Record<string, unknown>;
  const result: Record<string, string> = {};
  for (const key of keys) {
    if (typeof source[key] !== "string") {
      throw new Error(`AI extracted field ${key} is invalid`);
    }
    result[key] = source[key].trim();
  }
  return result;
}
