import assert from "node:assert/strict";
import test from "node:test";
import {
  formatQuoteNumber,
  normalizeQuoteNumberingSettings,
} from "../lib/quote-numbering";

test("formats automatic quote numbers with a yearly sequence", () => {
  assert.equal(
    formatQuoteNumber(
      { prefix: "off", nextNumber: 12, resetYearly: true },
      2026,
    ),
    "OFF-2026-0012",
  );
});

test("supports continuous numbers without a year", () => {
  assert.equal(
    formatQuoteNumber(
      { prefix: "SOL", nextNumber: 3, resetYearly: false },
      2026,
    ),
    "SOL-0003",
  );
});

test("normalizes incomplete numbering settings safely", () => {
  assert.deepEqual(normalizeQuoteNumberingSettings({ prefix: "" }), {
    mode: "automatic",
    prefix: "OFF",
    nextNumber: 1,
    startNumber: 1,
    resetYearly: true,
    year: null,
  });
});
