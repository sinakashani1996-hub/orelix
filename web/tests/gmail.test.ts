import assert from "node:assert/strict";
import test from "node:test";
import { normalizeGmailHistoryId } from "../lib/gmail-history";

test("normalizes Gmail history IDs stored as decimal text", () => {
  assert.equal(normalizeGmailHistoryId("1326993.0"), "1326993");
  assert.equal(normalizeGmailHistoryId(1326993), "1326993");
  assert.equal(normalizeGmailHistoryId("1326993"), "1326993");
});

test("rejects malformed Gmail history IDs", () => {
  assert.throws(() => normalizeGmailHistoryId("1326993.5"));
  assert.throws(() => normalizeGmailHistoryId("not-a-history-id"));
});
