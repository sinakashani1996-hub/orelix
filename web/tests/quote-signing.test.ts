import assert from "node:assert/strict";
import test from "node:test";
import {
  createSigningToken,
  hashQuoteSnapshot,
  hashSigningToken,
  safeSignerName,
} from "../lib/quote-signing";
import type { QuoteBuilder } from "../lib/quote-builder";

test("creates secret signing tokens and stores only stable hashes", async () => {
  const left = createSigningToken();
  const right = createSigningToken();
  assert.notEqual(left, right);
  assert.ok(left.length >= 40);
  assert.equal(await hashSigningToken(left), await hashSigningToken(left));
  assert.notEqual(await hashSigningToken(left), await hashSigningToken(right));
});

test("quote snapshot hashes change when commercial terms change", async () => {
  const quote = {
    version: 1,
    quoteNumber: "OFF-1",
    lines: [],
  } as unknown as QuoteBuilder;
  const original = await hashQuoteSnapshot(quote);
  const changed = await hashQuoteSnapshot({ ...quote, quoteNumber: "OFF-2" });
  assert.notEqual(original, changed);
});

test("normalizes the signer's full name", () => {
  assert.equal(safeSignerName("  Isis   Janssens  "), "Isis Janssens");
  assert.throws(() => safeSignerName("I"), /volledige naam/i);
});
