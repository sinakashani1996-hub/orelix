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
    buildingOlderThan10Years: "ja",
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
  assert.deepEqual(body.analysis.missingFields, [
    "buildingAge",
    "roofType",
    "batteryPreference",
  ]);
});

test("keeps facts from a customer reply and asks only for real gaps", async () => {
  const genericModelAnswer = {
    ...validAnalysis,
    customerName: "Sina",
    extracted: {
      address: "",
      buildingOlderThan10Years: "",
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
    "buildingAge",
    "annualUsageKwhOrPanelCount",
    "batteryPreference",
  ]);
  assert.match(body.analysis.draft, /volledige adres/i);
  assert.match(body.analysis.draft, /ouder dan 10 jaar/i);
  assert.match(body.analysis.draft, /jaarlijkse elektriciteitsverbruik/i);
  assert.match(body.analysis.draft, /thuisbatterij/i);
  assert.doesNotMatch(body.analysis.draft, /type dak/i);
  assert.doesNotMatch(body.analysis.draft, /wanneer u de installatie/i);
});

test("never turns a model-invented address into a customer fact", async () => {
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
            body: "Beste,\n\nGraag zou ik een offerte willen voor 27 zonnepanelen.\n\nMet vriendelijke groeten,\nAdolf",
          },
        ],
      }),
    }),
    {
      AI_SHARED_SECRET: "test-secret",
      AI: {
        run: async () => ({
          response: {
            ...validAnalysis,
            customerName: "Adolf",
            extracted: { ...validAnalysis.extracted, address: "adres", panelCount: "27" },
          },
        }),
      },
    },
  );
  const body = await response.json();
  assert.equal(body.analysis.extracted.address, "");
  assert.deepEqual(body.analysis.missingFields, [
    "address",
    "buildingAge",
    "roofType",
    "batteryPreference",
  ]);
  assert.match(body.analysis.draft, /voor 27 zonnepanelen/i);
  assert.match(body.analysis.draft, /volledige adres/i);
  assert.match(body.analysis.draft, /ouder dan 10 jaar/i);
  assert.doesNotMatch(body.analysis.draft, /we noteren alvast adres/i);
  assert.doesNotMatch(body.analysis.draft, /aanvullende informatie/i);
  assert.doesNotMatch(body.analysis.draft, /woning, appartement of bedrijfspand/i);
  assert.doesNotMatch(body.analysis.draft, /wanneer u de installatie/i);
  assert.match(body.analysis.draft, /thuisbatterij/i);
});

test("recognizes a customer reply with a common spelling error for leien dak", async () => {
  const response = await worker.fetch(
    new Request("https://relay.test/api/ai/analyze", {
      method: "POST",
      headers: {
        authorization: "Bearer test-secret",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        preferredModule: "quote_assistant",
        conversation: [
          {
            role: "customer",
            body: "Oude Mechelsbaan 178, 3200 Aarschot\nLeiden dak",
          },
        ],
      }),
    }),
    {
      AI_SHARED_SECRET: "test-secret",
      AI: { run: async () => ({ response: validAnalysis }) },
    },
  );
  const body = await response.json();
  assert.deepEqual(body.analysis.missingFields, [
    "buildingAge",
    "annualUsageKwhOrPanelCount",
    "batteryPreference",
  ]);
  assert.doesNotMatch(body.analysis.draft, /welk type dak/i);
});
