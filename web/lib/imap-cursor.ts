/** Uses the stored IMAP UID cursor so normal syncs fetch only new messages. */
export function imapSearchCommand(afterUid?: string | null) {
  if (afterUid && /^\d+$/.test(afterUid)) {
    const nextUid = BigInt(afterUid) + 1n;
    return `UID SEARCH UID ${nextUid}:*`;
  }
  return "UID SEARCH ALL";
}
