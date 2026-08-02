import assert from "node:assert/strict";
import test from "node:test";
import { validateAnalysis } from "../lib/ai-assistant";

test("validates a structured conversational quote analysis", () => {
  const result = validateAnalysis({
    moduleId: "quote_assistant",
    kind: "quote_request",
    title: "Offerteconcept klaar",
    summary: "Alle gegevens zijn aanwezig",
    status: "needs_approval",
    confidence: 97,
    customerName: "Isis",
    draft: "Beste Isis,\n\nUw offerteconcept staat klaar.",
    extracted: {
      address: "Oude Mechelsbaan 189",
      propertyType: "woning",
      annualUsageKwh: "4200",
      panelCount: "9",
      roofType: "pannendak",
      batteryPreference: "zonder thuisbatterij",
      desiredTiming: "binnen 3 maanden",
    },
    missingFields: [],
    quoteReady: true,
    quote: {
      title: "Offerte zonnepanelen",
      introduction: "Voorstel voor de woning van Isis.",
      scope: ["Levering en plaatsing van 9 zonnepanelen"],
      assumptions: ["Definitief na technische controle"],
      validityDays: 30,
    },
  });
  assert.equal(result.quoteReady, true);
  assert.equal(result.customerName, "Isis");
  assert.equal(result.extracted.address, "Oude Mechelsbaan 189");
});
