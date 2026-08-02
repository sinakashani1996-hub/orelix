export function normalizeGmailHistoryId(value: unknown) {
  const normalized = String(value ?? "").trim();
  const integerValue = normalized.replace(/\.0+$/, "");
  if (!/^\d+$/.test(integerValue)) {
    throw new Error("Gmail returned an invalid history ID");
  }
  return integerValue;
}

/**
 * Decide whether the stored Gmail history cursor may advance.
 *
 * Gmail's history endpoint returns the complete delta since a cursor while that
 * cursor is within the retention window. When the window is valid we can safely
 * advance to the newer notification id, because Gmail has reported every change
 * in between. When the call failed (stale window or transient error) we hold the
 * cursor so a recovery scan or the next push can still see the missed messages,
 * instead of letting them fall permanently behind the horizon.
 */
export function nextHistoryCursor(opts: {
  historyAvailable: boolean;
  notificationHistoryId: string;
  currentHistoryId: string;
}): string {
  return opts.historyAvailable
    ? opts.notificationHistoryId
    : opts.currentHistoryId;
}

