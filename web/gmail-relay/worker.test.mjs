import assert from "node:assert/strict";
import test from "node:test";
import worker from "./worker.js";

const validAnalysis = {
  moduleId: "quote_assistant",
  kind: "missing_information",
  title: "Ontbrekende gegevens",
  summary: "Daktype ontbreekt",
  status: "draft_ready",
  confidence: 96,
  customerName: "Isis",
  draft: "Beste Isis,\n\nWelk type dak heeft de woning?\n\nMet vriendelijke groeten,\nFirst Client BV",
  extracted: {
    address: "Oude Mechelsbaan 189",
    propertyType: "woning",
    annualUsageKwh: "",
    panelCount: "9",
    roofType: "",
    batteryPreference: "weet ik nog niet",
    desiredTiming: "",
  },
  missingFields: ["roofType", "desiredTiming"],
  quoteReady: false,
  quote: {
    title: "",
    introduction: "",
    scope: [],
    assumptions: [],
    validityDays: 30,
  },
};

test("protects and returns structured AI analysis", async () => {
  const env = {
    AI_SHARED_SECRET: "test-secret",
    AI: {
      run: async () => ({ response: validAnalysis }),
    },
  };
  const unauthorized = await worker.fetch(
    new Request("https://relay.test/api/ai/analyze", {
      method: "POST",
      body: JSON.stringify({ conversation: [{ role: "customer", body: "Hoi" }] }),
    }),
    env,
  );
  assert.equal(unauthorized.status, 401);

  const response = await worker.fetch(
    new Request("https://relay.test/api/ai/analyze", {
      method: "POST",
      headers: {
        authorization: "Bearer test-secret",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        conversation: [
          {
            role: "customer",
            body: "Beste,\n\nIk wil 9 zonnepanelen op mijn woning in Oude Mechelsbaan 189, 2800 Mechelen.\n\nMvg,\nIsis",
          },
        ],
      }),
    }),
    env,
  );
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.analysis.customerName, "Isis");
  assert.equal(body.analysis.missingFields.length, 2);
});

test("keeps facts from a customer reply and asks only for real gaps", async () => {
  const genericModelAnswer = {
    ...validAnalysis,
    customerName: "Sina",
    extracted: {
      address: "",
      propertyType: "",
      annualUsageKwh: "",
      panelCount: "",
      roofType: "",
      batteryPreference: "",
      desiredTiming: "",
    },
    missingFields: [
      "address",
      "propertyType",
      "annualUsageKwhOrPanelCount",
      "roofType",
      "batteryPreference",
      "desiredTiming",
    ],
    draft: "Vraag alles opnieuw.",
  };
  const response = await worker.fetch(
    new Request("https://relay.test/api/ai/analyze", {
      method: "POST",
      headers: {
        authorization: "Bearer test-secret",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        knownData: { propertyType: "woning" },
        conversation: [
          {
            role: "customer",
            body:
              "Beste,\n\nAdres is Fonteinstraat 47\nRijhove\nHeeft een plat dak\nBinnen drie maanden liefst.\n\nMvg,\nRaffa\n\nOp 24 juli schreef Tom:\n> Welk type dak heeft u?",
          },
        ],
      }),
    }),
    {
      AI_SHARED_SECRET: "test-secret",
      AI: { run: async () => ({ response: genericModelAnswer }) },
    },
  );
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.analysis.customerName, "Raffa");
  assert.deepEqual(body.analysis.missingFields, [
    "address",
    "annualUsageKwhOrPanelCount",
  ]);
  assert.match(body.analysis.draft, /postcode en gemeente/i);
  assert.match(body.analysis.draft, /jaarlijks elektriciteitsverbruik/i);
  assert.doesNotMatch(body.analysis.draft, /type dak/i);
  assert.doesNotMatch(body.analysis.draft, /wanneer u de installatie/i);
});
