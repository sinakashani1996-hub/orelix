import assert from "node:assert/strict";
import test from "node:test";
import {
  nextHistoryCursor,
  normalizeGmailHistoryId,
} from "../lib/gmail-history";

// Regression guard for the original history-id normalization.
test("normalizeGmailHistoryId keeps decimal history ids stable", () => {
  assert.equal(normalizeGmailHistoryId("1326993"), "1326993");
  assert.equal(normalizeGmailHistoryId(1326993), "1326993");
  assert.equal(normalizeGmailHistoryId("1326993.0"), "1326993");
});

// The core fix: a valid history window advances the cursor to the newer
// notification id. This is what lets processing move forward normally.
test("nextHistoryCursor advances to the notification id when the history window is valid", () => {
  assert.equal(
    nextHistoryCursor({
      historyAvailable: true,
      notificationHistoryId: "2000",
      currentHistoryId: "1500",
    }),
    "2000",
  );
});

// The bug we are fixing: when the history call failed (stale window or a
// transient Gmail error), the old code still advanced the cursor to the
// notification id. That dropped every message between the old cursor and the
// notification permanently behind the horizon. The cursor must stay put so the
// recovery scan or the next push can still see those messages.
test("nextHistoryCursor holds the cursor when the history window is unavailable", () => {
  assert.equal(
    nextHistoryCursor({
      historyAvailable: false,
      notificationHistoryId: "2000",
      currentHistoryId: "1500",
    }),
    "1500",
  );
});
