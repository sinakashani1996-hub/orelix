import assert from "node:assert/strict";
import test from "node:test";
import {
  analyzeEmailForModule,
  analyzeInboundEmail,
} from "../lib/quote-analyzer";

test("routes solar faults to the service assistant", () => {
  const result = analyzeInboundEmail(
    "Omvormer foutcode",
    "Mijn omvormer werkt niet meer en geeft foutcode 32.",
    "Tom De Smet",
  );
  assert.equal(result.moduleId, "service_assistant");
  assert.equal(result.status, "routed");
});

test("asks only for missing quote intake information", () => {
  const result = analyzeInboundEmail(
    "Offerte zonnepanelen",
    "Ik wil graag 12 zonnepanelen voor mijn woning.",
    "Elise Vermeulen",
  );
  assert.equal(result.moduleId, "quote_assistant");
  assert.equal(result.kind, "missing_information");
  assert.match(result.draft, /straat, huisnummer, postcode en gemeente/i);
  assert.doesNotMatch(result.draft, /aantal panelen/i);
});

test("asks a concise battery question", () => {
  const result = analyzeInboundEmail(
    "Offerte zonnepanelen",
    "Ik wil 12 zonnepanelen voor mijn woning aan Kerkstraat 12, 2000 Antwerpen. Het is een pannendak en ik wil de installatie binnen 3 maanden.",
    "Jan Peeters",
  );
  assert.equal(result.kind, "missing_information");
  assert.match(result.draft, /wilt u bij de zonnepanelen ook een thuisbatterij/i);
  assert.doesNotMatch(result.draft, /twee prijsvoorstellen/i);
  assert.doesNotMatch(result.draft, /kies gerust/i);
  assert.doesNotMatch(result.draft, /beide varianten/i);
  assert.doesNotMatch(result.draft, /volledige installatieadres/i);
});

test("creates a review item for a complete request", () => {
  const result = analyzeInboundEmail(
    "Offerte zonnepanelen",
    "Ik wil 12 zonnepanelen voor mijn woning aan Kerkstraat 12, 2000 Antwerpen. Het is een pannendak, zonder thuisbatterij, binnen 3 maanden.",
    "Jan Peeters",
  );
  assert.equal(result.moduleId, "quote_assistant");
  assert.equal(result.status, "needs_approval");
  assert.equal(result.kind, "quote_request");
  assert.match(result.draft, /we hebben de volgende gegevens genoteerd/i);
  assert.doesNotMatch(
    result.draft,
    /controleer de technische gegevens en bedragen voordat/i,
  );
});

test("recognizes a request to order solar panels as a quote intake", () => {
  const result = analyzeInboundEmail(
    "Zonnepanelen",
    "Hallo.\n\nIk zou graag zonnepanelen willen bestellen, hoe kan dit?\n\nMvg,\nIsis",
    "Sina Kashani Sepehr",
  );
  assert.equal(result.moduleId, "quote_assistant");
  assert.equal(result.kind, "missing_information");
  assert.match(result.draft, /bedankt voor uw aanvraag voor zonnepanelen/i);
  assert.match(result.draft, /^beste isis,/i);
  assert.doesNotMatch(result.draft, /^beste sina,/i);
});

test("can manually reassign the original email to the quote assistant", () => {
  const result = analyzeEmailForModule(
    "quote_assistant",
    "Nieuwe aanvraag",
    "Hallo, kunt u mij hiermee helpen?",
    "Isis",
  );
  assert.equal(result.moduleId, "quote_assistant");
  assert.equal(result.kind, "missing_information");
  assert.match(result.draft, /beste isis/i);
});
